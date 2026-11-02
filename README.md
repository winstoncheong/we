# we

A thin, local-first code editor: Rust server, HTML over the wire, and two
SolidJS islands where a round-trip would be wrong.

- **Server:** Axum + Askama. Owns session state (tabs, active buffer, dirty set),
  filesystem access, git diffs, and every fragment the UI swaps in.
- **Chrome:** htmx. The file tree (lazy per directory), tabs, status bar and
  command palette are server-rendered HTML; no client-side router or store.
- **Islands:** SolidJS + CodeMirror 6 for the editor (vim keybindings), and
  `@pierre/diffs` for the diff view.
- **Look:** the diffs.com language — sans-serif chrome, monospace code, quiet
  neutral surfaces, hairline borders, one blue accent, explicit light/dark.

Architecture details and the htmx/island contract live in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run

```sh
npm --prefix web install

# dev: Rust on :7788, Vite with HMR on :5173
cargo run -p we-server -- --dev --root .
npm --prefix web run dev
```

```sh
# production: one binary + built assets
npm --prefix web run build
cargo run --release -p we-server -- --root .
```

The server looks for assets in `web/dist` relative to the working directory
(override with `WE_ASSETS`). `web/dist` is not committed.

## Checks

```sh
cargo test -p we-server            # Rust unit tests (paths, palette, watcher)
npm --prefix web run typecheck     # tsc --noEmit
```

CI (`.github/workflows/build-windows.yml`, Windows) runs the tests, typecheck,
`npm run build`, then a release build and a `/health` + shell + `/app.css`
smoke test. There is no JS test runner and no lint step.

Setup notes for agents live in [AGENTS.md](AGENTS.md).

### Desktop app

The desktop shell runs the same server in-process on a random loopback port and
embeds `web/dist` in the binary, so the shipped app is self-contained.

```sh
npm --prefix web run build          # assets are compiled into the app
cargo run --release -p we-desktop   # window + embedded server

# dev: run the server yourself and point the window at it
cargo run -p we-server -- --dev &
WE_SERVER_URL=http://127.0.0.1:7788 cargo run -p we-desktop
```

Installers: `npm --prefix desktop run build` (Tauri CLI, NSIS on Windows).
Set `WE_ROOT` or pass a directory to open a specific workspace (the shell
defaults to your home directory, unlike `we-server`, which uses the cwd).

`we-server` flags: `--root <dir>` (workspace to open, defaults to cwd),
`--port <n>` (default 7788), `--dev` (load assets from Vite).

## Shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+P` | quick open (fuzzy, gitignore-aware, background-indexed) |
| `Ctrl+Shift+P` | command palette |
| `Ctrl+B` | toggle sidebar |
| `Ctrl+S` | save active buffer |
| `Ctrl+Shift+V` | markdown preview (md/mdx) |

Vim keybindings are on by default (`@replit/codemirror-vim`); the status bar
shows the current mode. Theme toggling lives in the titlebar (`◐`) and the
command palette; closing a buffer is the tab's `×` or the "Close tab" command
(browsers reserve `Ctrl+W`).

## Notes

- Askama compiles templates into the binary: rebuild after editing
  `server/templates/*`.
- Every mutating request carries a per-run `X-We-Token` header so other pages
  cannot drive the local server.
- Paths are workspace-relative and validated; nothing outside `--root` is
  readable.
- Quick open answers from a background index primed at startup, so a huge root
  (the desktop app's default home directory) never blocks a request. While the
  index is still building, the palette shows partial results and refreshes
  itself.
- The watcher only refreshes the explorer on structural changes (adds, removes,
  renames); saving a file does not collapse open folders.
