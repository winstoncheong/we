use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use crate::assets::AssetSource;

use tokio::sync::broadcast;

pub struct App {
    pub root: PathBuf,
    pub root_name: String,
    /// Random per-run token required on state-changing requests. Blocks
    /// cross-origin form posts from any page that can reach loopback.
    pub token: String,
    pub is_repo: bool,
    pub dev: bool,
    pub assets: Arc<dyn AssetSource>,
    pub session: RwLock<Session>,
    /// Filesystem change notifications fanned out to `/events` subscribers.
    pub fs: broadcast::Sender<String>,
}

#[derive(Default)]
pub struct Session {
    pub tabs: Vec<String>,
    pub active: Option<String>,
    pub dirty: BTreeSet<String>,
}

impl Session {
    pub fn open(&mut self, path: &str) {
        if !self.tabs.iter().any(|p| p == path) {
            self.tabs.push(path.to_string());
        }
        self.active = Some(path.to_string());
    }

    pub fn activate(&mut self, path: &str) {
        if self.tabs.iter().any(|p| p == path) {
            self.active = Some(path.to_string());
        }
    }

    pub fn close(&mut self, path: &str) {
        let Some(index) = self.tabs.iter().position(|p| p == path) else {
            return;
        };
        self.tabs.remove(index);
        self.dirty.remove(path);
        if self.active.as_deref() == Some(path) {
            self.active = self.tabs.get(index.saturating_sub(1)).cloned();
        }
    }

    pub fn set_dirty(&mut self, path: &str, dirty: bool) {
        if dirty {
            self.dirty.insert(path.to_string());
        } else {
            self.dirty.remove(path);
        }
    }
}

impl App {
    pub fn new(root: PathBuf, dev: bool, token: String, assets: Arc<dyn AssetSource>) -> Self {
        let root_name = root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| root.to_string_lossy().to_string());
        let is_repo = root.join(".git").exists();
        let (fs, _) = broadcast::channel(64);
        Self {
            root,
            root_name,
            token,
            is_repo,
            dev,
            assets,
            session: RwLock::new(Session::default()),
            fs,
        }
    }
}
