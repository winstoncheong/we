# we

Thin local personal editor. Vite + React + CodeMirror 6 frontend, Tauri native shell.

Goals: vim keybindings, file tree, Sublime-like shortcuts, fast/responsive.
Languages: LaTeX, Python, HTML, JS/TS, Markdown, JSON.

## Look

Everything is painted from one Pierre theme (`@pierre/theme`) through
`@pierre/theming`:

- `src/theme/pierre.ts` resolves `pierre-dark` / `pierre-light` into CSS
  variables for the app chrome, inline styles for the file tree, and the token
  colors used for syntax highlighting.
- `src/editor/theme.ts` maps CodeMirror tags onto TextMate scopes and builds the
  editor chrome + highlight style from the same theme.
- `src/theme/*` swap at runtime (`ctrl+k ctrl+t`), chrome, tree and syntax move
  together.

Type: Berkeley Mono if installed, falling back to the platform mono stack.
Layout: monospace, hairline rules, square corners, no shadows or gradients.

## Deps

- `@replit/codemirror-vim` (CodeMirror 6 vim mode — package is `codemirror-vim` on neither npm scope; the maintained one is `@replit/codemirror-vim`)
- `@pierre/trees` + `@pierre/trees/react` (file tree)
- `@pierre/theme` + `@pierre/theming` (color source and derivation)
- Tauri 2 + `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog` (local FS)

## Run

```sh
npm install
npm run dev        # browser demo (in-memory files)
npm run tauri dev  # native, real FS
```

Shortcuts: `Ctrl+P` files, `Ctrl+Shift+P` commands, `Ctrl+S` save,
`Ctrl+O` open folder, `Ctrl+W` close tab, `Ctrl+B` sidebar,
`Ctrl+K Ctrl+B` sidebar, `Ctrl+K Ctrl+T` theme.

## Windows prerequisite for Tauri

Tauri needs the MSVC linker, which this machine currently lacks
(no `link.exe` / `vcvarsall.bat` found; only target `x86_64-pc-windows-msvc`
installed with nothing to link against). Install once (admin):

```sh
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"
```

then `cargo check --manifest-path src-tauri/Cargo.toml`.
