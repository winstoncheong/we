// Desktop shell: the same server the browser talks to, running in-process on a
// random loopback port, with the browser bundle compiled into the binary.
//
// Dev: point the window at a server you are already running instead of starting
// one (`WE_SERVER_URL=http://127.0.0.1:7788 npm --prefix desktop run dev`).

use std::path::PathBuf;
use std::sync::Arc;

use include_dir::{include_dir, Dir};
use tauri::{WebviewUrl, WebviewWindowBuilder};
use we_server::assets::EmbeddedAssets;

static DIST: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/../web/dist");

fn workspace_root() -> PathBuf {
    if let Ok(root) = std::env::var("WE_ROOT") {
        return PathBuf::from(root);
    }
    if let Some(arg) = std::env::args().nth(1) {
        return PathBuf::from(arg);
    }
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn main() -> anyhow::Result<()> {
    let dev_url = std::env::var("WE_SERVER_URL").ok();
    let root = workspace_root().canonicalize().unwrap_or_else(|_| workspace_root());

    // Bind before the window exists so the URL is known and the port is free.
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();

    let target = match &dev_url {
        Some(url) => url.clone(),
        None => format!("http://127.0.0.1:{port}/"),
    };
    let url: tauri::Url = target.parse()?;

    println!("we · {target} · {}", root.display());

    tauri::Builder::default()
        .setup(move |app| {
            if dev_url.is_none() {
                let state = we_server::build_app(
                    root.clone(),
                    false,
                    we_server::random_token(),
                    Arc::new(EmbeddedAssets(&DIST)),
                );
                let listener = listener;
                tauri::async_runtime::spawn(async move {
                    let result = async {
                        let listener = tokio::net::TcpListener::from_std(listener)?;
                        we_server::serve(listener, state).await
                    }
                    .await;
                    if let Err(err) = result {
                        eprintln!("we-server stopped: {err:#}");
                    }
                });
            }

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.clone()))
                .title("we")
                .inner_size(1280.0, 860.0)
                .min_inner_size(720.0, 480.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .map_err(|err| anyhow::anyhow!("tauri: {err}"))
}
