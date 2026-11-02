# Architecture

`we` is a local-first editor built as a hypermedia app: a Rust server renders
HTML, htmx swaps fragments, and two small SolidJS islands own the parts that
cannot round-trip (the code editor and the diff renderer).

No React. No client-side router. No global store.

```
┌──────────────────────────── browser ────────────────────────────┐
│  shell.html (Askama)                                            │
│  ├─ #tabs   ← htmx fragments                                    │
│  ├─ #tree   ← htmx fragments (lazy per directory)               │
│  ├─ #status ← htmx fragments (out-of-band on every action)      │
│  └─ #editor-island / #diff-body  ← SolidJS islands              │
└─────────────────────────────────────────────────────────────────┘
             │ fetch / htmx                     ▲ HX-Trigger-After-Swap
             ▼                                  │
┌──────────────────────── Axum (127.0.0.1) ───────────────────────┐
│  session state: open tabs, active buffer, dirty set             │
│  filesystem: read/write/children (workspace-rooted)             │
│  git: status + patch for the active file                        │
│  assets: web/dist (prod) or Vite dev server (dev)               │
└─────────────────────────────────────────────────────────────────┘
```

## Runtime shape

- One process, bound to `127.0.0.1:7788` (configurable with `--port`).
- Two front doors, one server: the `we-server` CLI serves `web/dist` from disk,
  and the `we-desktop` Tauri shell runs the same router in-process on a random
  port with the bundle compiled into the binary (`include_dir` + the `embed`
  feature). Nothing in `web/` depends on the webview.
- Every mutating request must carry `X-We-Token` (random per run, injected into
  the shell as a meta tag and as `hx-headers` on `<body>`). Blocks cross-origin
  form posts from other pages that can reach loopback.
- Paths are workspace-relative, validated by `files::resolve` (no `..`, no
  absolutes, must stay under the root).

## Dev loop

```sh
cargo run -p we-server -- --dev        # http://127.0.0.1:7788
npm --prefix web run dev               # Vite on 127.0.0.1:5173
```

`--dev` renders `<script src="http://127.0.0.1:5173/src/main.tsx">`; Vite serves
the islands with HMR. Templates are compiled into the binary, so **template
edits need `cargo build`**.

Production: `npm --prefix web run build` then `cargo build --release`; the
server serves `web/dist` at the root (`/app.js`, `/app.css`, chunks) and
`WE_ASSETS` overrides the directory.

## Htmx contract

Fragments:

| Route | Returns |
| --- | --- |
| `GET /fragments/tree?dir=` | children of `dir` (lazy `<details>` expansion) |
| `GET /fragments/tabs` | tab strip |
| `GET /fragments/status` | status bar |
| `GET /fragments/palette?mode=files\|commands&q=` | palette shell, or just its results (`results_only=1`) |
| `GET /events` | SSE stream of `fs` events labelled `structure` (entries added/removed/renamed) or `change` (contents only) |
| `POST /actions/open\|activate\|close` | tabs + OOB status, then a `we:open` event |
| `POST /actions/dirty` | tabs + OOB status |
| `GET /api/file?path=` | raw text for the editor island |
| `PUT /api/file?path=` | save (island → server) |
| `GET /api/diff?path=` | JSON patch + original/current |
| `GET /diff?path=` | full-page diff view |

Mutations answer with the tabs fragment and an out-of-band status bar, then set
`HX-Trigger-After-Swap: {"we:open":{"path":"…"}}`. The event fires **after** the
DOM swap, so islands never read a half-updated page.

Rules:

- Every DOM subtree has exactly one writer. htmx owns tree/tabs/status;
  Solid owns `#editor-island` and `#diff-body`.
- High-frequency facts (cursor position, vim mode, dirty dot while typing) are
  written directly by the island; structural facts (tabs list, dirty count)
  round-trip through htmx, debounced.
- The filesystem watcher only refreshes chrome (tree/tabs/status). It never
  reloads the editor buffer, so unsaved work is never clobbered.
- The tree is refreshed for structural events only (`structure`), and its
  expansion state is restored client-side across swaps; a save never collapses
  an open folder.
- Saving is island-owned: `Ctrl+S` saves the active buffer, the command
  palette's "Save all" dispatches `we:save-all`, and the island writes every
  buffer whose text differs from what it loaded.
- No `hx-boost`, no client router.

## Islands

- `web/src/editor` — CodeMirror 6 + vim keybindings. One `EditorView`, one
  `EditorState` per buffer (per-file undo history), compartmented theme/vim,
  `External` transaction annotation to stop doc-sync loops. Owns save (Ctrl+S),
  dirty reporting, cursor/vim status.
- `web/src/diff` — `@pierre/diffs` renders the patch server-side provides.
- `web/src/preview` — markdown/MDX side-by-side preview with synced scrolling.

## Chrome

- `web/src/chrome` holds everything that is not an island: htmx wiring, global
  shortcuts, the SSE watch loop, and client-only state that must survive swaps
  (sidebar, tree expansion, palette retry budget).
- `tree.ts` snapshots open `<details>` before a tree swap and re-opens them on
  `htmx:afterSettle` — not `afterSwap`, because htmx attaches `hx-trigger` to
  swapped nodes during settle.
- `watch.ts` refreshes tabs/status on every `fs` event and the tree only for
  `structure`.

## Design

Tokens live in `web/src/styles/tokens.css` (imported by `app.css`): sans-serif
chrome, mono only for code, 10/8/6px radii, 1px borders at 10% alpha, one blue
accent, computed diff tints. Light and dark are explicit (`.light` on `<html>`,
persisted in localStorage), and every token needs both values.

## Performance rules

- Rendering happens on the server; the client ships no framework for the chrome.
- The tree is lazy: only the children of expanded folders are rendered.
- Quick-open answers from a background index of the workspace files, primed at
  startup. The walk itself never runs on a request or async worker; while it is
  still going the palette shows partial results and refreshes itself.
- The editor is the only always-on island. Typing never hits the network except
  a debounced dirty flag; saving is explicit (or on blur/close).
- Markdown preview renders off the hot path: 150–250ms trailing debounce,
  per-block patching, `content-visibility: auto`.
- Diff parsing/rendering runs in the diff island only; the editor page never
  loads `@pierre/diffs`.
