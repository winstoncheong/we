# AGENTS.md

`we` is a local-first code editor: a Rust/Axum + Askama server renders HTML,
htmx swaps fragments, and SolidJS islands own what cannot round-trip
(CodeMirror editor, `@pierre/diffs` diff view, markdown preview). No React, no
client router, no client store. Read `docs/ARCHITECTURE.md` before changing the
page structure; it is the contract, not background reading.

## Layout

- `server/` — `we-server` (lib + binary). Router: `src/routes/mod.rs`; in-memory
  session state: `src/state.rs`; path safety: `src/files.rs`; git: `src/git.rs`;
  SSE fs watcher: `src/watcher.rs`. Askama templates in `server/templates/`.
- `web/` — Vite + Solid. `src/main.tsx` is the only entry; `src/chrome/` is htmx
  glue, global shortcuts, SSE watch, and tree/palette client state; islands in
  `src/editor/`, `src/diff/`, `src/preview/`.
- `desktop/` — Tauri v2 shell. Runs the same router in-process on a random
  loopback port and embeds `web/dist` at compile time.
- `docs/DESIGN-POLISH.md` is an unimplemented backlog of markup/CSS proposals,
  not a description of the current UI.

## Commands

```sh
npm --prefix web ci                # install web deps (package-lock.json is committed)
npm --prefix web run typecheck     # tsc --noEmit; strict + noUnusedLocals/Parameters
npm --prefix web run build         # writes web/dist/app.js + app.css (gitignored)
cargo test -p we-server            # the only test suite (Rust unit tests)
cargo test -p we-server resolves_inside_workspace   # single test by name
cargo test -p we-server palette::                   # single module
```

Dev loop (two terminals; Vite port 5173 is hard-coded and `strictPort: true`):

```sh
cargo run -p we-server -- --dev --root .
npm --prefix web run dev
```

Production/desktop:

```sh
npm --prefix web run build
cargo run --release -p we-server -- --root .          # serves web/dist from disk
cargo run --release -p we-desktop                     # embeds web/dist; use WE_ROOT to pick a workspace
WE_SERVER_URL=http://127.0.0.1:7788 cargo run -p we-desktop   # dev: attach to a running server
```

Exact CI order (`.github/workflows/build-windows.yml`, Windows only):
`cargo test -p we-server` → `npm ci` → `npm run typecheck && npm run build` →
release build → `/health` + shell + `/app.css` smoke test. There is no JS test
runner and no ESLint; `.oxlintrc.json` exists but `oxlint` is not installed or
wired into any script, so `typecheck` is the JS gate.

## Gotchas

- Askama compiles templates into the binary. Editing `server/templates/*` does
  nothing until `cargo build` (a running dev server keeps serving old markup).
- `desktop/src/main.rs` embeds `web/dist` with `include_dir!` at compile time
  and `desktop/build.rs` only warns when it is missing. Fresh worktrees have no
  `web/dist` → run `npm --prefix web run build` and rebuild after asset edits,
  or the window ships stale/missing JS.
- `we-server` serves assets from `WE_ASSETS` or `web/dist` **relative to the
  current directory**. Run it from the repo root, or set `WE_ASSETS`.
- Every mutating request (POST/PUT/PATCH/DELETE) needs the per-run `X-We-Token`
  header; the shell injects it via a meta tag and `<body hx-headers>`. Manual
  curl/fetch calls get 403 without it. Client `fetch` code reads it with
  `token()` from `web/src/theme.ts`.
- All filesystem paths are workspace-relative and must go through
  `files::resolve`. It strips a leading `/`, rejects `..` and drive/UNC
  prefixes, then canonicalizes and requires the result to stay under the root.
  Never join raw user input onto `app.root`.
- Session state (tabs, active buffer, dirty set) is in memory only: restarting
  the server loses it, and there is no cross-process sync.
- `web/src/main.tsx` assigns `window.htmx` because htmx's ESM build does not;
  other modules read it lazily via `chrome/htmx.ts`. Don't import `htmx.org`
  again in an island.
- Git diffing shells out to the `git` CLI in the workspace root (no libgit2);
  behavior differs when the root is not a repo or files are untracked.
- `cargo run -p we-desktop` with no arg opens the user's home directory, not the
  repo. Pass `WE_ROOT` or a path argument.
- Quick-open must never walk the workspace on the request path. The file list
  is a process-global background index in `routes/palette.rs` (primed by
  `build_app`), and requests answer from whatever is indexed. A synchronous
  walk here once made Ctrl+P take ~59s on a home directory. Add new skip rules
  in `palette::SKIP`, not in a request handler.

## UI contract (breaking this causes subtle bugs)

- One writer per DOM subtree: htmx owns `#tree`, `#tabs`, `#status`, palette;
  Solid owns `#editor-island` and `#diff-body`. `main.tsx` guards island mounts
  with `data-mounted` — don't let htmx replace those roots.
- Mutations return the tabs fragment plus an out-of-band status bar, then send
  `HX-Trigger-After-Swap: {"we:open":{"path":"…"}}`. Islands react to that
  event, never to raw HTML responses.
- Programmatic editor changes are tagged with the `External` transaction
  annotation; dropping it creates doc-sync loops.
- The fs watcher refreshes chrome only. It labels each coalesced burst
  `structure` (create/remove/rename) or `change` (contents); the client
  refetches the tree only for `structure`, while tabs and status follow every
  event. It must never reload the editor buffer, or unsaved edits are
  clobbered. Saving is island-owned (`Ctrl+S`).
- Tree expansion survives fragment swaps: `chrome/tree.ts` remembers open
  directories and re-opens them on `htmx:afterSettle`. It must be `afterSettle`
  (not `afterSwap`) because htmx wires `hx-trigger` on swapped nodes during
  settle; restoring earlier loads nothing for nested folders.
- The palette polls while the server index is incomplete. That loop is driven
  by the hidden `data-indexing` marker in the palette results fragment; keep it
  when changing `partials/palette.html`, or the "Indexing files…" state sticks.
- `server/src/git.rs` `kind` constants and `DiffKind` in `web/src/diff/island.ts`
  are a hand-maintained pair; change both together.
- Keep server-rendered chrome free of client frameworks. Vite emits `app.js`,
  `app.css` and lazy-loaded chunks into `web/dist`; the router's fallback serves
  anything under that directory, so new assets need no route.

## Conventions

- Rust edition 2024, workspace members `server` + `desktop`, resolver 3.
- Design tokens live in `web/src/styles/tokens.css` (imported by `app.css`);
  every token needs both a dark and a light value. Use existing tokens instead
  of new colors/radii.
- High-frequency facts (cursor, vim mode) are written directly by the island;
  structural facts (tabs, dirty count) round-trip through htmx, debounced.
- Tests live inline in the modules they cover (`files`, `watcher`,
  `routes::palette`); add cases there rather than a separate tests crate.
- Chrome behavior has no automated coverage: tree expansion restore, palette
  polling, SSE refresh. `cargo test` + `typecheck` can pass while the UI is
  broken, so verify chrome changes in a browser against `--dev`.
