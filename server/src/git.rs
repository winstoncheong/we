use std::path::Path;
use std::process::Stdio;

use serde::Serialize;
use tokio::process::Command;

use crate::files::FsError;

/// Files bigger than this on either side are not sent to the browser: the JSON
/// payload would dwarf the page and parsing it would stall the tab.
const MAX_TEXT_BYTES: usize = 1024 * 1024;
/// Raw patch cap; above this the renderer cannot do anything useful.
const MAX_PATCH_BYTES: usize = 2 * 1024 * 1024;

/// What the client should put on screen. Keep in sync with `DiffKind` in
/// web/src/diff/island.ts.
pub mod kind {
    /// Both sides are available; render a real diff.
    pub const MODIFIED: &str = "modified";
    /// Exists on disk, not in git: diff empty → current.
    pub const UNTRACKED: &str = "untracked";
    /// Matches HEAD; nothing to show.
    pub const CLEAN: &str = "clean";
    /// Workspace is not a repository at all.
    pub const NO_REPO: &str = "no-repo";
    /// Not text; no line diff possible.
    pub const BINARY: &str = "binary";
    /// Past the size caps.
    pub const TOO_LARGE: &str = "too-large";
    /// git itself failed; `message` carries stderr.
    pub const ERROR: &str = "error";
}

#[derive(Serialize, Default)]
pub struct DiffPayload {
    pub is_repo: bool,
    /// One of the `kind` constants above.
    pub kind: String,
    /// Porcelain status code, e.g. `M`, `??`, `AM`. Empty when clean.
    pub status: String,
    pub patch: String,
    pub original: String,
    pub current: String,
    pub path: String,
    pub message: String,
    pub additions: usize,
    pub deletions: usize,
}

async fn run(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(root)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|err| format!("could not run git: {err}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }
    // First non-empty stderr line is enough for the empty state; the rest is
    // usually noise ("hint: use --...").
    let stderr = String::from_utf8_lossy(&output.stderr);
    let line = stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    Err(if line.is_empty() {
        format!("git {} failed", args.first().copied().unwrap_or(""))
    } else {
        line.to_string()
    })
}

/// Best-effort variant for probes where failure is a normal answer.
async fn probe(root: &Path, args: &[&str]) -> Option<String> {
    run(root, args).await.ok()
}

pub fn is_repo(root: &Path) -> bool {
    // A worktree or submodule has `.git` as a file, not a directory.
    root.join(".git").exists()
}

/// `git status --porcelain` puts the two-character code first; the path after
/// it is noise for a single-file view.
fn porcelain_code(line: &str) -> &str {
    line.get(..2).map(str::trim).unwrap_or("")
}

fn count_patch(patch: &str) -> (usize, usize) {
    let mut additions = 0;
    let mut deletions = 0;
    for line in patch.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            additions += 1;
        } else if line.starts_with('-') {
            deletions += 1;
        }
    }
    (additions, deletions)
}

pub async fn diff(root: &Path, rel: &str, current: Result<String, FsError>) -> DiffPayload {
    let mut payload = DiffPayload {
        is_repo: is_repo(root),
        path: rel.to_string(),
        ..Default::default()
    };
    if !payload.is_repo {
        payload.kind = kind::NO_REPO.into();
        payload.message = "This folder is not a git repository.".into();
        return payload;
    }

    // A deleted file still deserves a diff, so only hard read failures (binary,
    // oversized) short-circuit.
    let (text, read_failure) = match current {
        Ok(text) => (text, None),
        Err(FsError::NotFound) => (String::new(), None),
        Err(FsError::Binary) => (String::new(), Some(kind::BINARY)),
        Err(FsError::TooLarge) => (String::new(), Some(kind::TOO_LARGE)),
        Err(err) => {
            payload.kind = kind::ERROR.into();
            payload.message = err.to_string();
            return payload;
        }
    };

    let status = match run(root, &["status", "--porcelain", "--", rel]).await {
        Ok(output) => output,
        Err(message) => {
            payload.kind = kind::ERROR.into();
            payload.message = message;
            return payload;
        }
    };
    payload.status = status
        .lines()
        .next()
        .map(porcelain_code)
        .unwrap_or("")
        .to_string();

    if let Some(too_large_or_binary) = read_failure {
        payload.kind = too_large_or_binary.to_string();
        payload.message = if too_large_or_binary == kind::BINARY {
            "Binary files cannot be diffed.".into()
        } else {
            "This file is too large to diff.".into()
        };
        return payload;
    }

    if text.len() > MAX_TEXT_BYTES {
        payload.kind = kind::TOO_LARGE.into();
        payload.message = format!(
            "This file is larger than {} KiB; the diff view stays closed.",
            MAX_TEXT_BYTES / 1024
        );
        return payload;
    }

    if payload.status.is_empty() {
        // Nothing to compare: keep file contents out of the payload.
        payload.kind = kind::CLEAN.into();
        payload.message = "No changes against HEAD.".into();
        return payload;
    }

    if payload.status == "??" {
        // Untracked: the client diffs an empty original against the file.
        payload.kind = kind::UNTRACKED.into();
        payload.message = "Untracked file — comparing against an empty file.".into();
        payload.additions = text.lines().count();
        payload.current = text;
        return payload;
    }

    let mut original = String::new();
    let mut head_error = None;
    match run(root, &["show", &format!("HEAD:{rel}")]).await {
        Ok(head) => original = head,
        Err(message) => head_error = Some(message),
    }

    let head_exists = probe(root, &["rev-parse", "--verify", "--quiet", "HEAD"])
        .await
        .is_some();
    // `A` means the file only exists in the index, so a missing HEAD side is
    // normal. Anything else is a real failure worth surfacing.
    if let Some(message) = head_error {
        if head_exists && !payload.status.contains('A') {
            payload.kind = kind::ERROR.into();
            payload.message = format!("Could not read the committed version: {message}");
            return payload;
        }
        original = String::new();
    }

    if original.len() > MAX_TEXT_BYTES {
        payload.kind = kind::TOO_LARGE.into();
        payload.message = "The committed version is too large to diff.".into();
        return payload;
    }

    let patch = match run(
        root,
        &["diff", "HEAD", "--no-color", "--no-ext-diff", "--", rel],
    )
    .await
    {
        Ok(patch) => patch,
        Err(message) => {
            payload.kind = kind::ERROR.into();
            payload.message = message;
            return payload;
        }
    };

    let numstat = probe(root, &["diff", "HEAD", "--numstat", "--", rel])
        .await
        .unwrap_or_default();
    // Anchor on a line start: a patch *about* this file contains the marker as
    // ordinary text, and a substring test would call it binary.
    let mut binary = patch
        .lines()
        .any(|line| line.starts_with("GIT binary patch"));
    for line in numstat.lines() {
        let mut columns = line.split('\t');
        let (Some(additions), Some(deletions)) = (columns.next(), columns.next()) else {
            continue;
        };
        if additions == "-" || deletions == "-" {
            binary = true;
            continue;
        }
        payload.additions += additions.parse::<usize>().unwrap_or(0);
        payload.deletions += deletions.parse::<usize>().unwrap_or(0);
    }
    if payload.additions == 0 && payload.deletions == 0 && !patch.is_empty() {
        let (additions, deletions) = count_patch(&patch);
        payload.additions = additions;
        payload.deletions = deletions;
    }

    if binary {
        payload.kind = kind::BINARY.into();
        payload.message = "Binary files cannot be diffed.".into();
        return payload;
    }

    if patch.trim().is_empty() {
        // Tracked, dirty in some non-textual way (mode, symlink target…).
        payload.kind = kind::CLEAN.into();
        payload.message = "No textual changes against HEAD.".into();
        return payload;
    }

    if patch.len() > MAX_PATCH_BYTES {
        payload.kind = kind::TOO_LARGE.into();
        payload.message = format!(
            "This diff is too large to render ({} lines changed).",
            payload.additions + payload.deletions
        );
        return payload;
    }

    payload.kind = kind::MODIFIED.into();
    payload.patch = patch;
    payload.original = original;
    payload.current = text;
    payload
}
