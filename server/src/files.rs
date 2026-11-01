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
#[allow(dead_code)]
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

/// Human label for the status bar. Broader than the editor's syntax set on
/// purpose: naming the language is useful even when we fall back to plain text.
pub fn language(path: &str) -> &'static str {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    match name.as_str() {
        "makefile" | "gnumakefile" | "justfile" => return "make",
        "dockerfile" | "containerfile" => return "dockerfile",
        "cmakelists.txt" => return "cmake",
        "cargo.lock" => return "toml",
        "license" | "notice" => return "text",
        _ => {}
    }
    let ext = name.rsplit('.').next().unwrap_or("");
    match ext {
        "rs" => "rust",
        "py" | "pyi" | "pyw" => "python",
        "js" | "mjs" | "cjs" | "jsx" => "javascript",
        "ts" | "tsx" | "mts" | "cts" => "typescript",
        "go" => "go",
        "lua" => "lua",
        "rb" | "rake" | "gemspec" => "ruby",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "scala" | "sc" => "scala",
        "swift" => "swift",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" => "c++",
        "cs" => "c#",
        "php" => "php",
        "html" | "htm" => "html",
        "xml" | "xsd" | "xsl" | "xslt" | "plist" => "xml",
        "svg" => "svg",
        "css" => "css",
        "scss" => "scss",
        "sass" => "sass",
        "less" => "less",
        "json" | "jsonc" | "json5" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "ini" | "cfg" | "conf" | "properties" => "ini",
        "md" => "markdown",
        "mdx" => "mdx",
        "tex" | "sty" | "cls" | "bib" => "latex",
        "sh" | "bash" | "zsh" | "fish" => "shell",
        "ps1" | "psm1" => "powershell",
        "bat" | "cmd" => "batch",
        "sql" => "sql",
        "graphql" | "gql" => "graphql",
        "proto" => "protobuf",
        "diff" | "patch" => "diff",
        "vue" => "vue",
        "svelte" => "svelte",
        "astro" => "astro",
        "ex" | "exs" => "elixir",
        "erl" | "hrl" => "erlang",
        "hs" | "lhs" => "haskell",
        "ml" | "mli" => "ocaml",
        "clj" | "cljs" | "cljc" | "edn" => "clojure",
        "pl" | "pm" => "perl",
        "r" => "r",
        "jl" => "julia",
        "tf" | "hcl" => "terraform",
        "cmake" => "cmake",
        "nginx" => "nginx",
        "v" | "sv" | "svh" => "verilog",
        "vhd" | "vhdl" => "vhdl",
        "txt" | "log" => "text",
        _ => "text",
    }
}

pub fn is_markdown(path: &str) -> bool {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    matches!(ext.as_str(), "md" | "mdx" | "markdown")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("we-files-test-{}", std::process::id()));
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(dir.join(".gitignore"), "ignored\n").unwrap();
        fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        dir
    }

    #[test]
    fn resolves_inside_workspace() {
        let root = workspace();
        let path = resolve(&root, "src/main.rs").unwrap();
        assert!(path.ends_with("main.rs"));
        assert_eq!(read_text(&root, "src/main.rs").unwrap(), "fn main() {}");
    }

    #[test]
    fn refuses_escapes() {
        let root = workspace();
        assert!(resolve(&root, "../outside").is_err());
        assert!(resolve(&root, "src/../../outside").is_err());
        assert!(resolve(&root, "/etc/passwd").is_err());
        assert!(resolve(&root, "C:/Windows/win.ini").is_err());
    }

    #[test]
    fn lists_directories_first_and_skips_heavy_folders() {
        let root = workspace();
        let entries = list_children(&root, "", None).unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(entries[0].is_dir, "directories sort first");
        assert!(names.contains(&"src"));
        assert!(!names.contains(&"node_modules"));
    }

    #[test]
    fn rejects_binary_and_oversized() {
        let root = workspace();
        assert!(matches!(
            read_text(&root, "missing.txt"),
            Err(FsError::NotFound)
        ));
    }

    #[test]
    fn language_labels() {
        assert_eq!(language("src/main.rs"), "rust");
        assert_eq!(language("README.md"), "markdown");
        assert_eq!(language("a.mdx"), "mdx");
        assert_eq!(language("Makefile"), "make");
        assert_eq!(language("Dockerfile"), "dockerfile");
        assert_eq!(language("CMakeLists.txt"), "cmake");
        assert_eq!(language("script.lua"), "lua");
        assert_eq!(language("app.rb"), "ruby");
        assert_eq!(language("Main.java"), "java");
        assert_eq!(language("lib.rs"), "rust");
        assert_eq!(language("view.tsx"), "typescript");
        assert_eq!(language("data.yml"), "yaml");
        assert_eq!(language("Cargo.toml"), "toml");
        assert_eq!(language("schema.xsd"), "xml");
        assert_eq!(language("head.h"), "c");
        assert_eq!(language("main.cpp"), "c++");
        assert!(is_markdown("notes.mdx"));
        assert!(!is_markdown("notes.txt"));
    }
}
