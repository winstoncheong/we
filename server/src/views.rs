use crate::files::{self, Entry};
use crate::state::App;

#[derive(Clone)]
pub struct TabView {
    pub path: String,
    pub name: String,
    pub dir: String,
    pub active: bool,
    pub dirty: bool,
}

#[derive(Clone)]
pub struct View {
    pub version: &'static str,
    pub dev: bool,
    pub vite_url: String,
    pub token: String,
    pub root_name: String,
    pub is_repo: bool,
    pub tabs: Vec<TabView>,
    pub has_tabs: bool,
    pub active_path: String,
    pub active_name: String,
    pub language: String,
    pub dirty_count: usize,
    pub entries: Vec<Entry>,
    pub markdown: bool,
    pub has_active: bool,
    pub diff_mode: bool,
}

fn split(path: &str) -> (String, String) {
    match path.rfind('/') {
        Some(index) => (path[..index].to_string(), path[index + 1..].to_string()),
        None => (String::new(), path.to_string()),
    }
}

/// Chrome state only (no directory listing); handlers add tree data as needed.
pub fn build(app: &App) -> View {
    let session = app.session.read().unwrap();
    let active = session.active.clone().unwrap_or_default();

    let tabs = session
        .tabs
        .iter()
        .map(|path| {
            let (dir, name) = split(path);
            TabView {
                path: path.clone(),
                name,
                dir,
                active: *path == active,
                dirty: session.dirty.contains(path),
            }
        })
        .collect::<Vec<_>>();

    let (_, active_name) = split(&active);

    View {
        version: env!("CARGO_PKG_VERSION"),
        dev: app.dev,
        vite_url: "http://127.0.0.1:5173".to_string(),
        token: app.token.clone(),
        root_name: app.root_name.clone(),
        is_repo: app.is_repo,
        has_tabs: !tabs.is_empty(),
        tabs,
        language: if active.is_empty() {
            String::new()
        } else {
            files::language(&active).to_string()
        },
        dirty_count: session.dirty.len(),
        entries: Vec::new(),
        markdown: !active.is_empty() && files::is_markdown(&active),
        has_active: !active.is_empty(),
        active_path: active,
        active_name,
        diff_mode: false,
    }
}

pub fn with_root_tree(app: &App, view: &mut View) {
    view.entries = files::list_children(&app.root, "", Some(&view.active_path)).unwrap_or_default();
}

pub fn tree_for(app: &App, dir: &str, active: &str) -> Result<Vec<Entry>, files::FsError> {
    files::list_children(&app.root, dir, Some(active))
}
