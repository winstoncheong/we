//! Filesystem watcher: one debounced broadcast for the whole workspace.
//!
//! The shell already knows how to refresh itself from fragments, so the watcher
//! only has to say *that* something changed over SSE. The client refreshes the
//! tree, tab strip and status bar — never the editor buffer.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use notify::{EventKind, RecursiveMode, Watcher};
use tokio::sync::broadcast;

/// Build output and VCS internals churn constantly and never deserve a
/// fragment refresh. Matched by path component, so `web/dist` is covered too.
const IGNORED: &[&str] = &[
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
];

/// Trailing edits of one save arrive as several events; wait them out.
const COALESCE: Duration = Duration::from_millis(250);

pub fn spawn(root: PathBuf, tx: broadcast::Sender<String>) {
    if let Err(err) = std::thread::Builder::new()
        .name("we-watch".into())
        .spawn(move || run(root, tx))
    {
        eprintln!("watch: {err}");
    }
}

fn run(root: PathBuf, tx: broadcast::Sender<String>) {
    let (raw_tx, raw_rx) = mpsc::channel();
    let mut watcher = match notify::recommended_watcher(move |event| {
        let _ = raw_tx.send(event);
    }) {
        Ok(watcher) => watcher,
        Err(err) => {
            eprintln!("watch: {err}");
            return;
        }
    };
    if let Err(err) = watcher.watch(&root, RecursiveMode::Recursive) {
        eprintln!("watch {}: {err}", root.display());
        return;
    }

    loop {
        let first = match raw_rx.recv() {
            Ok(Ok(event)) => event,
            Ok(Err(err)) => {
                eprintln!("watch: {err}");
                continue;
            }
            Err(_) => return,
        };

        let mut kind = first.kind;
        let mut paths = first.paths;
        let deadline = Instant::now() + COALESCE;
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            match raw_rx.recv_timeout(left) {
                Ok(Ok(next)) => {
                    if interesting(&next.kind) {
                        kind = next.kind;
                    }
                    paths.extend(next.paths);
                }
                Ok(Err(_)) => {}
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }

        // Reads (our own `/api/file` fetches) are not changes.
        if !interesting(&kind) || paths.is_empty() {
            continue;
        }
        if paths.iter().all(|path| ignored(path, &root)) {
            continue;
        }
        // No subscribers is fine; the send only fails when nobody listens.
        let _ = tx.send(label(&kind).to_string());
    }
}

fn interesting(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) | EventKind::Any
    )
}

fn label(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "create",
        EventKind::Remove(_) => "remove",
        EventKind::Modify(_) => "change",
        _ => "change",
    }
}

/// True when the path is inside a directory we never report on.
fn ignored(path: &Path, root: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        IGNORED.contains(&name.as_ref())
            || name.ends_with(".tmp")
            || name.ends_with('~')
            || name.starts_with(".#")
    })
}

#[cfg(test)]
mod tests {
    use super::ignored;
    use std::path::Path;

    #[test]
    fn ignores_build_output_and_vcs() {
        let root = Path::new("/work");
        assert!(ignored(Path::new("/work/target/debug/we-server"), root));
        assert!(ignored(Path::new("/work/.git/index"), root));
        assert!(ignored(Path::new("/work/node_modules/x/index.js"), root));
        assert!(ignored(Path::new("/work/web/dist/app.js"), root));
        assert!(ignored(Path::new("/work/src/main.rs~"), root));
        assert!(!ignored(Path::new("/work/src/main.tsx"), root));
        assert!(!ignored(Path::new("/work/server/src/main.rs"), root));
    }
}
