use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

/// Directories that would drown the tree and stall the walker.
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
];

#[derive(Serialize, Clone)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub active: bool,
}

#[derive(Debug)]
pub enum FsError {
    NotFound,
    Binary,
    TooLarge,
    Unsafe,
    Io(std::io::Error),
}

impl std::fmt::Display for FsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FsError::NotFound => write!(f, "not found"),
            FsError::Binary => write!(f, "binary file"),
            FsError::TooLarge => write!(f, "file too large to open"),
            FsError::Unsafe => write!(f, "path outside workspace"),
            FsError::Io(err) => write!(f, "{err}"),
        }
    }
}

impl From<std::io::Error> for FsError {
    fn from(value: std::io::Error) -> Self {
        if value.kind() == std::io::ErrorKind::NotFound {
            FsError::NotFound
        } else {
            FsError::Io(value)
        }
    }
}

/// Resolve a workspace-relative path, refusing escapes via `..` or absolutes.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf, FsError> {
    let rel = rel.trim_start_matches('/').replace('\\', "/");
    let candidate = Path::new(&rel);
    if candidate.is_absolute() {
        return Err(FsError::Unsafe);
    }
    for component in candidate.components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir => {}
            _ => return Err(FsError::Unsafe),
        }
    }
    let joined = root.join(candidate);
    let canonical = joined.canonicalize().map_err(|_| FsError::NotFound)?;
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    if !canonical.starts_with(&root) {
        return Err(FsError::Unsafe);
    }
    Ok(canonical)
}

/// Normalized relative path used as the public id for a file.
pub fn normalize(root: &Path, path: &Path) -> String {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let rel = path.strip_prefix(&root).unwrap_or(&path);
    rel.components()
        .filter_map(|c| match c {
            Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;

pub fn read_text(root: &Path, rel: &str) -> Result<String, FsError> {
    let path = resolve(root, rel)?;
    let meta = fs::metadata(&path)?;
    if !meta.is_file() {
        return Err(FsError::NotFound);
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(FsError::TooLarge);
    }
    let bytes = fs::read(&path)?;
    String::from_utf8(bytes).map_err(|_| FsError::Binary)
}

pub fn write_text(root: &Path, rel: &str, contents: &str) -> Result<(), FsError> {
    let path = resolve(root, rel)?;
    fs::write(path, contents)?;
    Ok(())
}

/// Direct children of `rel`, directories first, skipping heavyweight folders.
pub fn list_children(root: &Path, rel: &str, active: Option<&str>) -> Result<Vec<Entry>, FsError> {
    let dir = if rel.is_empty() {
        root.to_path_buf()
    } else {
        resolve(root, rel)?
    };
    let mut entries = Vec::new();
    for item in fs::read_dir(&dir)? {
        let item = item?;
        let name = item.file_name().to_string_lossy().to_string();
        let file_type = item.file_type()?;
        let is_dir = file_type.is_dir();
        if is_dir && SKIP.contains(&name.as_str()) {
            continue;
        }
        if !is_dir && !file_type.is_file() {
            continue;
        }
        let child = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        entries.push(Entry {
            name,
            active: !is_dir && active == Some(child.as_str()),
            path: child,
            is_dir,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Cheap-ish language label for the status bar.
pub fn language(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "rs" => "rust",
        "py" => "python",
        "js" | "mjs" | "cjs" => "javascript",
        "ts" | "tsx" => "typescript",
        "jsx" => "javascript",
        "html" | "htm" => "html",
        "css" => "css",
        "json" => "json",
        "md" => "markdown",
        "mdx" => "mdx",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "tex" | "sty" | "cls" | "bib" => "latex",
        "sh" | "bash" | "zsh" => "shell",
        "go" => "go",
        "lua" => "lua",
        "svg" => "svg",
        _ => "text",
    }
}

pub fn is_markdown(path: &str) -> bool {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    matches!(ext.as_str(), "md" | "mdx" | "markdown")
}
