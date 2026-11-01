// Static files for the shell (JS/CSS chunks, favicon). The browser build is
// either read from disk (dev, CLI runs from the repo) or embedded into the
// desktop binary at compile time.

use std::path::{Component, Path, PathBuf};

pub trait AssetSource: Send + Sync {
    fn read(&self, path: &str) -> Option<(Vec<u8>, &'static str)>;
}

pub fn mime_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "html" => "text/html; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "map" => "application/json",
        _ => "application/octet-stream",
    }
}

pub struct DiskAssets {
    root: PathBuf,
}

impl DiskAssets {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }
}

impl AssetSource for DiskAssets {
    fn read(&self, path: &str) -> Option<(Vec<u8>, &'static str)> {
        let relative = path.trim_start_matches('/');
        if relative.is_empty() {
            return None;
        }
        let candidate = Path::new(relative);
        if candidate.is_absolute()
            || candidate
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
        {
            return None;
        }
        let full = self.root.join(candidate);
        if !full.is_file() {
            return None;
        }
        let bytes = std::fs::read(&full).ok()?;
        Some((bytes, mime_for(relative)))
    }
}

#[cfg(feature = "embed")]
pub struct EmbeddedAssets(pub &'static include_dir::Dir<'static>);

#[cfg(feature = "embed")]
impl AssetSource for EmbeddedAssets {
    fn read(&self, path: &str) -> Option<(Vec<u8>, &'static str)> {
        let relative = path.trim_start_matches('/');
        if relative.is_empty() {
            return None;
        }
        let file = self.0.get_file(relative)?;
        Some((file.contents().to_vec(), mime_for(relative)))
    }
}
