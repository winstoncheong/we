# my-editor

Thin local personal editor. Vite + React + CodeMirror 6 frontend, Tauri native shell.

Goals: vim keybindings, file tree, Sublime-like shortcuts, fast/responsive.
Languages: LaTeX, Python, HTML, JS.

## Deps

- `@replit/codemirror-vim` (CodeMirror 6 vim mode — package is `codemirror-vim` on neither npm scope; the maintained one is `@replit/codemirror-vim`)
- `@pierre/trees` + `@pierre/trees/react` (file tree)
- Tauri 2 + `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog` (local FS)

## Run

```sh
npm install
npm run dev        # browser demo (in-memory files)
npm run tauri dev  # native, real FS
```

Shortcuts: `Ctrl+P` files, `Ctrl+Shift+P` commands, `Ctrl+S` save,
`Ctrl+W` close tab, `Ctrl+K Ctrl+B` sidebar.

## Windows prerequisite for Tauri

Tauri needs the MSVC linker, which this machine currently lacks
(no `link.exe` / `vcvarsall.bat` found; only target `x86_64-pc-windows-msvc`
installed with nothing to link against). Install once (admin):

```sh
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"
```

then `cargo check --manifest-path src-tauri/Cargo.toml`.
