//! Command palette fragments.
//!
//! One endpoint serves both the whole palette (input + results + footer) and
//! just the results list, so htmx can filter without re-rendering the chrome.
//! The file list is walked with `ignore` (gitignore-aware) by a background
//! index thread — never on the request path — and matched with a small
//! subsequence scorer.

use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use askama::Template;
use axum::extract::{Query, State};
use axum::response::Response;
use serde::Deserialize;

use super::render;
use crate::state::App;
use crate::views;

/// Directories that would drown the walker: build output, VCS internals and
/// dependency/cache stores. A workspace rooted at `$HOME` must not index
/// `~/.cargo/registry` or `~/AppData` — that is a minute-long walk for files
/// nobody quick-opens.
const SKIP: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    ".next",
    ".turbo",
    ".venv",
    "__pycache__",
    ".cache",
    ".idea",
    ".gradle",
    ".cargo",
    ".rustup",
    ".npm",
    ".pnpm-store",
    ".yarn",
    ".m2",
    ".nuget",
    ".stack-work",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".parcel-cache",
    ".svelte-kit",
    ".terraform",
    ".vercel",
    "AppData",
    "Library",
];

const MAX_FILES: usize = 250_000;
const RESULT_LIMIT: usize = 50;
/// Files whose *basename* fits the query outrank matches spread over the path.
const BASENAME_BONUS: i32 = 20;
/// A cold index pauses this long so a small workspace is complete on the very
/// first Ctrl+P. Bigger trees answer immediately and fill in behind.
const FIRST_WAIT: Duration = Duration::from_millis(150);
/// Stale-while-revalidate bounds, widened by how long the last walk took so a
/// huge workspace is not re-walked on every keystroke.
const TTL_MIN: Duration = Duration::from_secs(3);
const TTL_MAX: Duration = Duration::from_secs(120);

#[derive(Deserialize)]
pub struct PaletteQuery {
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub q: String,
    /// htmx sends `results_only=1` when it only wants the list re-rendered.
    #[serde(default)]
    pub results_only: String,
}

pub struct FileHit {
    pub path: String,
    pub name: String,
    pub dir: String,
}

pub struct CommandRow {
    pub id: String,
    pub name: String,
    pub hint: String,
    pub shortcut: String,
    pub disabled: bool,
}

#[derive(Template)]
#[template(path = "partials/palette.html")]
pub struct Palette {
    pub mode: String,
    pub mode_label: String,
    pub placeholder: String,
    pub query: String,
    pub results_only: bool,
    pub hits: Vec<FileHit>,
    pub commands: Vec<CommandRow>,
    pub count_label: String,
    /// The background walk has not finished; results are partial.
    pub indexing: bool,
}

pub async fn fragment(State(app): State<Arc<App>>, Query(query): Query<PaletteQuery>) -> Response {
    let mode = if query.mode == "commands" {
        "commands"
    } else {
        "files"
    };
    let results_only = !query.results_only.is_empty();
    let view = views::build(&app);

    let mut hits = Vec::new();
    let mut commands = Vec::new();
    let mut indexing = false;
    let count_label;

    if mode == "commands" {
        commands = command_rows(&query.q, &view);
        count_label = if commands.is_empty() {
            "no commands".to_string()
        } else {
            format!("{} commands", commands.len())
        };
    } else {
        // The index may need a filesystem walk; keep it off the async workers
        // so a big workspace cannot stall the rest of the chrome.
        let root = app.root.clone();
        let needle = query.q.clone();
        let found = tokio::task::spawn_blocking(move || search_files(&root, &needle, RESULT_LIMIT))
            .await
            .unwrap_or_else(|_| (Vec::new(), false));
        (hits, indexing) = found;
        count_label = file_count_label(&hits, indexing);
    }

    render(&Palette {
        mode: mode.to_string(),
        mode_label: if mode == "commands" {
            "Commands".to_string()
        } else {
            "Files".to_string()
        },
        placeholder: if mode == "commands" {
            "Type a command…".to_string()
        } else {
            "Search files by name…".to_string()
        },
        query: query.q,
        results_only,
        hits,
        commands,
        count_label,
        indexing,
    })
}

fn file_count_label(hits: &[FileHit], indexing: bool) -> String {
    if indexing {
        return if hits.is_empty() {
            "indexing…".to_string()
        } else {
            format!("{} files · indexing…", hits.len())
        };
    }
    if hits.is_empty() {
        "no matches".to_string()
    } else if hits.len() >= RESULT_LIMIT {
        format!("{RESULT_LIMIT}+ files")
    } else {
        format!("{} files", hits.len())
    }
}

fn command_rows(query: &str, view: &views::View) -> Vec<CommandRow> {
    let has_active = view.has_active;
    let commands = vec![
        CommandRow {
            id: "toggle-theme".into(),
            name: "Toggle theme".into(),
            hint: "dark / light".into(),
            shortcut: "".into(),
            disabled: false,
        },
        CommandRow {
            id: "toggle-sidebar".into(),
            name: "Toggle sidebar".into(),
            hint: "collapse the explorer".into(),
            shortcut: "Ctrl B".into(),
            disabled: false,
        },
        CommandRow {
            id: "save-all".into(),
            name: "Save all".into(),
            hint: if has_active {
                "write every modified buffer".into()
            } else {
                "no buffer open".into()
            },
            shortcut: "Ctrl S".into(),
            disabled: !has_active,
        },
        CommandRow {
            id: "close-tab".into(),
            name: "Close tab".into(),
            hint: if has_active {
                format!("close {}", view.active_name)
            } else {
                "no buffer open".into()
            },
            shortcut: "".into(),
            disabled: !has_active,
        },
        CommandRow {
            id: "open-diff".into(),
            name: "Open diff".into(),
            hint: if view.is_repo {
                "active file vs HEAD".into()
            } else {
                "not a git workspace".into()
            },
            shortcut: "".into(),
            disabled: !(has_active && view.is_repo),
        },
        CommandRow {
            id: "preview-toggle".into(),
            name: "Toggle markdown preview".into(),
            hint: if view.markdown {
                "side-by-side preview".into()
            } else {
                "open a markdown file first".into()
            },
            shortcut: "".into(),
            disabled: !view.markdown,
        },
    ];

    // Commands are few; rank them with the same fuzzy matcher as files so the
    // palette behaves the same in both modes.
    let mut ranked = commands
        .into_iter()
        .filter_map(|row| score(query, &row.name).map(|s| (s, row)))
        .collect::<Vec<_>>();
    ranked.sort_by(|a, b| b.0.cmp(&a.0));
    ranked.into_iter().map(|(_, row)| row).collect()
}

// ── file search ───────────────────────────────────────────────────────────

/// The workspace file index.
///
/// Walking a large tree (a home directory can hold millions of entries) takes
/// tens of seconds, so the walk runs on its own thread and never on the request
/// path. Requests answer from whatever is indexed: a fresh small workspace is
/// complete before the first palette even renders, a huge one fills in behind
/// the `indexing` flag.
struct Index {
    root: PathBuf,
    files: Arc<Vec<String>>,
    /// When the last completed walk finished.
    built: Option<Instant>,
    /// When the walk in flight started; `None` when idle.
    started: Option<Instant>,
    /// How long the last walk took, used to space out rebuilds.
    took: Duration,
}

impl Index {
    fn ttl(&self) -> Duration {
        (self.took * 4).clamp(TTL_MIN, TTL_MAX)
    }

    fn stale(&self) -> bool {
        match self.built {
            None => true,
            Some(at) => at.elapsed() >= self.ttl(),
        }
    }
}

static INDEX: Mutex<Option<Index>> = Mutex::new(None);
static WALKED: Condvar = Condvar::new();

/// Start indexing a workspace in the background (called once at startup).
pub fn prime(root: &Path) {
    let root = root.to_path_buf();
    std::thread::spawn(move || {
        let _ = workspace_files(&root);
    });
}

/// Ranked hits, plus whether the index is still incomplete.
pub fn search_files(root: &Path, query: &str, limit: usize) -> (Vec<FileHit>, bool) {
    let (files, indexing) = workspace_files(root);
    let mut scored = files
        .iter()
        .filter_map(|path| score(query, path).map(|s| (s, path)))
        .collect::<Vec<_>>();
    scored.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.len().cmp(&b.1.len()))
            .then_with(|| a.1.cmp(b.1))
    });
    let hits = scored
        .into_iter()
        .take(limit)
        .map(|(_, path)| hit(path))
        .collect();
    (hits, indexing)
}

fn hit(path: &str) -> FileHit {
    match path.rfind('/') {
        Some(index) => FileHit {
            path: path.to_string(),
            name: path[index + 1..].to_string(),
            dir: path[..index].to_string(),
        },
        None => FileHit {
            path: path.to_string(),
            name: path.to_string(),
            dir: String::new(),
        },
    }
}

fn workspace_files(root: &Path) -> (Arc<Vec<String>>, bool) {
    let mut guard = INDEX.lock().unwrap_or_else(|err| err.into_inner());

    // A second server in the same process (tests, embedded runs) starts clean.
    if guard.as_ref().is_some_and(|index| index.root != root) {
        *guard = None;
    }
    if guard.is_none() {
        *guard = Some(Index {
            root: root.to_path_buf(),
            files: Arc::new(Vec::new()),
            built: None,
            started: None,
            took: Duration::ZERO,
        });
    }

    let stale = guard.as_ref().is_some_and(|index| index.stale());
    if stale {
        let index = guard.as_mut().expect("index initialised above");
        if index.started.is_none() {
            index.started = Some(Instant::now());
            spawn_walk(index.root.clone());
        }
    }

    // Cold index: let a small tree finish so the first palette is complete.
    if let Some(started) = guard.as_ref().and_then(|index| index.started) {
        let wait = FIRST_WAIT.saturating_sub(started.elapsed());
        if !wait.is_zero() {
            let (next, _) = WALKED
                .wait_timeout(guard, wait)
                .unwrap_or_else(|err| err.into_inner());
            guard = next;
        }
    }

    let index = guard.as_ref().expect("index initialised above");
    // "Indexing" only while there has never been a complete walk; a stale
    // rebuild in flight still answers from the previous list.
    (index.files.clone(), index.built.is_none())
}

fn spawn_walk(root: PathBuf) {
    let spawned = std::thread::Builder::new()
        .name("we-index".into())
        .spawn(move || {
            let at = Instant::now();
            let mut files = collect_files(&root);
            files.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
            let took = at.elapsed();

            let mut guard = INDEX.lock().unwrap_or_else(|err| err.into_inner());
            if let Some(index) = guard.as_mut()
                && index.root == root
            {
                index.files = Arc::new(files);
                index.built = Some(Instant::now());
                index.took = took;
                index.started = None;
            }
            WALKED.notify_all();
        });

    if let Err(err) = spawned {
        eprintln!("palette index: {err}");
        let mut guard = INDEX.lock().unwrap_or_else(|err| err.into_inner());
        if let Some(index) = guard.as_mut() {
            index.started = None;
        }
    }
}

fn collect_files(root: &Path) -> Vec<String> {
    use ignore::WalkBuilder;

    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(false)
        .parents(false)
        .ignore(true)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .follow_links(false)
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            // In a linked worktree `.git` is a file, not a directory.
            if name == ".git" {
                return false;
            }
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if !is_dir {
                return true;
            }
            !SKIP.contains(&name.as_ref())
        });

    let mut files = Vec::new();
    for entry in builder.build().flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let Some(rel) = entry.path().strip_prefix(root).ok().map(relative) else {
            continue;
        };
        if rel.is_empty() {
            continue;
        }
        files.push(rel);
        if files.len() >= MAX_FILES {
            break;
        }
    }
    files
}

/// Workspace-relative path with forward slashes, no canonicalize round-trip.
fn relative(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Subsequence match with bonuses for word starts, consecutive hits and
/// matches in the basename. Returns `None` when the query does not fit.
pub fn score(query: &str, haystack: &str) -> Option<i32> {
    let needle = query
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|c| !c.is_whitespace())
        .collect::<Vec<_>>();

    let hay = haystack
        .chars()
        .flat_map(char::to_lowercase)
        .collect::<Vec<_>>();

    let depth = hay.iter().filter(|c| **c == '/').count() as i32;

    if needle.is_empty() {
        // No query: shallow files first, then alphabetical (caller sorts ties).
        return Some(-depth * 10);
    }

    let base_start = hay
        .iter()
        .rposition(|c| *c == '/')
        .map(|index| index + 1)
        .unwrap_or(0);

    // Trying the basename on its own stops a query like "chrome" from matching
    // the parent directory of every file and losing the file named chrome.*.
    if let Some(base) = score_slice(&needle, &hay[base_start..]) {
        return Some(base + BASENAME_BONUS);
    }

    score_slice(&needle, &hay)
}

fn score_slice(needle: &[char], hay: &[char]) -> Option<i32> {
    let mut total: i32 = 0;
    let mut cursor = 0;
    let mut previous: Option<usize> = None;

    for wanted in needle {
        let mut found = None;
        while cursor < hay.len() {
            if hay[cursor] == *wanted {
                found = Some(cursor);
                cursor += 1;
                break;
            }
            cursor += 1;
        }
        let index = found?;

        total += 10;
        match previous {
            Some(prev) if index == prev + 1 => total += 12,
            Some(prev) => total -= ((index - prev - 1) as i32).min(10),
            None => {}
        }
        let boundary =
            index == 0 || matches!(hay[index - 1], '/' | '.' | '_' | '-' | ' ' | '(' | '[');
        if boundary {
            total += 8;
        }
        previous = Some(index);
    }

    // Ties are broken by path length in `search_files`, not here, so the score
    // stays a pure "how well does the query fit this path" measure.
    Some(total)
}

#[cfg(test)]
mod tests {
    use super::score;

    #[test]
    fn subsequence_matches_out_of_order_chars() {
        assert!(score("rts", "server/src/routes/palette.rs").is_some());
        assert!(score("palette", "server/src/routes/palette.rs").is_some());
        assert!(score("zzzz", "server/src/routes/palette.rs").is_none());
    }

    #[test]
    fn basename_matches_beat_directory_matches() {
        let basename = score("tabs", "src/tabs.rs").unwrap();
        let directory = score("tabs", "tabs/x.rs").unwrap();
        assert!(basename > directory, "expected {basename} > {directory}");
    }

    #[test]
    fn file_named_after_query_beats_siblings_in_matching_dir() {
        let css = score("chrome", "web/src/chrome/chrome.css").unwrap();
        let other = score("chrome", "web/src/chrome/htmx.ts").unwrap();
        assert!(css > other, "expected {css} > {other}");
    }

    #[test]
    fn empty_query_prefers_shallow_files() {
        let root = score("", "README.md").unwrap();
        let deep = score("", "server/src/routes/palette.rs").unwrap();
        assert!(root > deep);
    }
}
