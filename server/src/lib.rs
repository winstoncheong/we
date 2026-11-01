pub mod assets;
pub mod files;
pub mod git;
pub mod routes;
pub mod state;
pub mod views;
pub mod watcher;

use std::path::PathBuf;
use std::sync::Arc;

use assets::{AssetSource, DiskAssets};
use state::App;

/// Build the shared application state. `assets` decides where the browser
/// bundle comes from (disk for the CLI, embedded for the desktop binary).
pub fn build_app(
    root: PathBuf,
    dev: bool,
    token: String,
    assets: Arc<dyn AssetSource>,
) -> Arc<App> {
    let app = Arc::new(App::new(root, dev, token, assets));
    // One watcher per workspace, fanned out to `/events` subscribers.
    crate::watcher::spawn(app.root.clone(), app.fs.clone());
    app
}

pub fn disk_assets(root: impl Into<PathBuf>) -> Arc<dyn AssetSource> {
    Arc::new(DiskAssets::new(root))
}

/// Serve an already-bound listener until the future completes or the process
/// exits. The caller owns the listener so it can pick a random port first.
pub async fn serve(
    listener: tokio::net::TcpListener,
    app: Arc<App>,
) -> anyhow::Result<()> {
    axum::serve(listener, routes::router(app))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

/// Random per-run token; state-changing requests must present it.
pub fn random_token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    hasher.write_u128(nanos);
    format!("{:016x}{:08x}", hasher.finish(), std::process::id())
}
