mod files;
mod git;
mod routes;
mod state;
mod views;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Context;

use state::App;

fn random_token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    hasher.write_u128(nanos);
    format!("{:016x}{:08x}", hasher.finish(), std::process::id())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut root = std::env::current_dir()?;
    let mut port: u16 = 7788;
    let mut dev = false;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--root" => root = PathBuf::from(args.next().context("--root needs a value")?),
            "--port" => port = args.next().context("--port needs a value")?.parse()?,
            "--dev" => dev = true,
            "--help" | "-h" => {
                println!("we-server [--root DIR] [--port N] [--dev]");
                return Ok(());
            }
            other => eprintln!("ignoring unknown argument: {other}"),
        }
    }

    let root = root.canonicalize().context("cannot open workspace root")?;
    if !root.is_dir() {
        anyhow::bail!("{} is not a directory", root.display());
    }

    let app = Arc::new(App::new(root, dev, random_token()));
    let assets = std::env::var("WE_ASSETS").unwrap_or_else(|_| "web/dist".to_string());
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .context("cannot bind port")?;
    let addr = listener.local_addr()?;

    println!("we · {}", app.root.display());
    println!("    http://{addr}");
    if dev {
        println!("    dev assets from http://127.0.0.1:5173 (npm --prefix web run dev)");
    }

    axum::serve(listener, routes::router(app, &assets))
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
}

#[allow(dead_code)]
fn _addr_type(_: SocketAddr) {}
