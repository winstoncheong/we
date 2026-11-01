fn main() {
    // The browser bundle is compiled into this binary. Building the desktop app
    // without it would produce a window that serves nothing, so fail loudly.
    let dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/dist");
    if !dist.join("app.js").exists() {
        println!(
            "cargo:warning=web/dist is missing or stale; run `npm --prefix web run build` before building the desktop app"
        );
    }
    println!("cargo:rerun-if-changed=../web/dist");
    tauri_build::build()
}
