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
# dev: Rust on :7788, Vite with HMR on :5173
cargo run -p we-server -- --dev --root .

npm --prefix web install
npm --prefix web run dev
```

```sh
# production: one binary + built assets
npm --prefix web run build
cargo run --release -p we-server -- --root .
```

Flags: `--root <dir>` (workspace to open, defaults to cwd), `--port <n>`
(default 7788), `--dev` (load assets from Vite).

## Shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+P` | quick open |
| `Ctrl+Shift+P` | commands |
| `Ctrl+B` | toggle sidebar |
| `Ctrl+S` | save active buffer |
| `Ctrl+W` | close active tab |
| `Ctrl+Shift+V` | markdown preview (md/mdx) |
| `Ctrl+K` `Ctrl+T` | toggle theme |

Vim keybindings are on by default (`@replit/codemirror-vim`); the status bar
shows the current mode.

## Notes

- Askama compiles templates into the binary: rebuild after editing
  `server/templates/*`.
- Every mutating request carries a per-run `X-We-Token` header so other pages
  cannot drive the local server.
- Paths are workspace-relative and validated; nothing outside `--root` is
  readable.
