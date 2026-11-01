use std::path::Path;
use std::process::Stdio;

use serde::Serialize;
use tokio::process::Command;

#[derive(Serialize, Default)]
pub struct DiffPayload {
    pub is_repo: bool,
    pub status: String,
    pub patch: String,
    pub original: String,
    pub current: String,
    pub path: String,
    pub message: String,
}

async fn git(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .current_dir(root)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn is_repo(root: &Path) -> bool {
    root.join(".git").exists()
}

pub async fn diff(root: &Path, rel: &str, current: &str) -> DiffPayload {
    let mut payload = DiffPayload {
        is_repo: is_repo(root),
        path: rel.to_string(),
        current: current.to_string(),
        ..Default::default()
    };
    if !payload.is_repo {
        payload.message = "not a git repository".into();
        return payload;
    }

    let status = git(root, &["status", "--porcelain", "--", rel])
        .await
        .unwrap_or_default();
    payload.status = status.lines().next().unwrap_or("").trim().to_string();

    if payload.status.is_empty() {
        payload.message = "no changes against HEAD".into();
        payload.original = current.to_string();
        return payload;
    }

    payload.original = git(root, &["show", &format!("HEAD:{rel}")])
        .await
        .unwrap_or_default();

    let patch = git(
        root,
        &["diff", "HEAD", "--no-color", "--no-ext-diff", "--", rel],
    )
    .await
    .filter(|p| !p.trim().is_empty())
    .or_else(|| None);

    match patch {
        Some(patch) => payload.patch = patch,
        None => {
            if payload.status.starts_with("??") {
                payload.message = "untracked file".into();
            } else {
                payload.message = "no textual diff".into();
            }
        }
    }

    payload
}
