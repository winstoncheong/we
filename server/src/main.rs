use std::path::PathBuf;

use anyhow::Context;

fn main() -> anyhow::Result<()> {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run())
}

async fn run() -> anyhow::Result<()> {
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

    let assets_dir = std::env::var("WE_ASSETS").unwrap_or_else(|_| "web/dist".to_string());
    let app = we_server::build_app(root, dev, we_server::random_token(), we_server::disk_assets(&assets_dir));

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .context("cannot bind port")?;
    let addr = listener.local_addr()?;

    println!("we · {}", app.root.display());
    println!("    http://{addr}");
    if dev {
        println!("    dev assets from http://127.0.0.1:5173 (npm --prefix web run dev)");
    }

    we_server::serve(listener, app).await
}
