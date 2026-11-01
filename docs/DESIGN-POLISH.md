# Design polish

`web/src/styles/app.css` + `web/src/styles/tokens.css` are the design system:
sans chrome, mono code, hairline borders, 10/8/6px radii, one accent blue.
Everything in this document needs **markup** (Askama templates or Solid
islands), which lives in other worktrees, so it is written down here instead of
applied.

Each item has: why, the exact snippet, and the CSS to add next to it. Snippets
follow the existing template style (`{% if %}` guards, htmx attributes, token
names).

---

## 1. Titlebar

### 1.1 Command/search affordance

The 44px bar is mostly empty; a search trigger is the single biggest "product"
signal the shell is missing. It also gives the eye a center.

`server/templates/shell.html`, after `.brand`:

```html
<div class="spacer"></div>
<button class="btn ghost sm cmd-trigger" type="button" id="cmd-trigger"
        title="Search files (Ctrl P)">
  <span class="cmd-hint">Search files</span>
  <kbd class="kbd">Ctrl P</kbd>
</button>
<div class="spacer"></div>
```

CSS to add; the widths are already within the spacing scale:

```css
.cmd-trigger {
  flex: 0 1 380px;
  min-width: 140px;
  margin: 0 auto;
  justify-content: flex-start;
  gap: var(--sp-2);
  padding: 0 var(--sp-1) 0 10px;
  border-color: var(--border);
  border-radius: var(--radius-md);
  color: var(--dim);
  font-size: var(--fs-sm);
}
.cmd-trigger:hover {
  border-color: var(--border-strong);
  background: var(--card);
  color: var(--fg-muted);
}
.cmd-hint {
  flex: 1;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kbd {
  flex: 0 0 auto;
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: var(--panel);
  color: var(--dim);
  font: 500 10px/1 var(--font-sans);
  letter-spacing: 0.04em;
}
```

### 1.2 Branch (not just "git")

`{% if view.is_repo %}<span class="pill">git</span>{% endif %}` says the repo
exists but not where you are. The markup needs a `branch` field on the view:

```html
{% if view.branch.is_some() %}
<span class="pill mono" title="current branch">{{ view.branch.as_deref().unwrap_or("") }}</span>
{% endif %}
```

```css
.pill.mono {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0;
  text-transform: none;
}
```

### 1.3 Active path for orientation

The window title has it, but the chrome does not:

```html
{% if view.has_active %}
<span class="crumb" title="{{ view.active_path }}">{{ view.active_path }}</span>
{% endif %}
```

```css
.crumb {
  min-width: 0;
  max-width: 280px;
  overflow: hidden;
  color: var(--dim);
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Place it after the command trigger, before the right-hand buttons.

### 1.4 Icon buttons need labels

`title` is not an accessible name. Both templates:

```html
<button class="btn ghost sm" type="button" id="theme-toggle"
        title="Toggle theme" aria-label="Toggle color theme">
```

Same for `.tab-close` (`aria-label="Close {{ tab.name }}"`) and any future icon
button.

---

## 2. Sidebar and tree

### 2.1 Resizable (or collapsible) sidebar

`--sidebar` is `clamp(212px, 18vw, 264px)` today, which is responsive but not
adjustable. A 5px grip between the sidebar and main:

`shell.html`, between `</aside>` and `<main>`:

```html
<div class="resizer" id="sidebar-resizer" role="separator"
     aria-orientation="vertical" aria-label="Resize sidebar"></div>
```

```css
.resizer {
  flex: 0 0 5px;
  margin-left: -3px;
  cursor: col-resize;
  background: transparent;
  transition: background-color 120ms ease;
}
.resizer:hover,
.resizer:focus-visible,
.resizer[data-dragging] {
  background: var(--accent-soft);
}
```

Drag handler sets `--sidebar` on `.app` (the token is already read by
`.sidebar`), clamped to `200px…420px`. A collapse button in `.panel-head` is the
cheaper alternative: it only needs `data-collapsed` on `.app` plus
`.app[data-collapsed] .sidebar { display: none }`.

### 2.2 Panel head actions

`.panel-head` is a label + meta. A refresh target belongs there:

```html
<div class="panel-head">
  <span class="panel-title">Explorer</span>
  <span class="spacer"></span>
  <button class="icon-btn" type="button" title="Refresh tree"
          aria-label="Refresh tree"
          hx-get="/fragments/tree" hx-trigger="click" hx-target="#tree"
          hx-swap="innerHTML">⟳</button>
</div>
```

```css
.icon-btn {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-xs);
  color: var(--dim);
  font-size: 12px;
  line-height: 1;
  transition: background-color 120ms ease, color 120ms ease;
}
.icon-btn:hover {
  background: var(--hover);
  color: var(--fg);
}
```

### 2.3 File-type dots

Only if the server can expose an extension. It makes the tree scannable without
introducing icons:

`partials/tree.html`:

```html
<button class="tree-row file{% if entry.active %} is-active{% endif %}" ...>
  <span class="tree-dot" data-ext="{{ entry.ext }}"></span>
  <span class="tree-name">{{ entry.name }}</span>
</button>
```

```css
.tree-dot {
  flex: 0 0 5px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--dim);
  opacity: 0.7;
}
.tree-row[data-ext='rs'] .tree-dot { background: #dea584; }
.tree-row[data-ext='ts'] .tree-dot,
.tree-row[data-ext='tsx'] .tree-dot { background: #519aba; }
.tree-row[data-ext='css'] .tree-dot { background: #a074c4; }
.tree-row[data-ext='html'] .tree-dot { background: #e37933; }
.tree-row[data-ext='md'] .tree-dot { background: #8b9bb4; }
.tree-row[data-ext='json'] .tree-dot { background: var(--warn); }
```

Keep it to six or seven dots; a rainbow tree fights the one-accent rule.

### 2.4 Tree semantics

```html
<nav class="tree" id="tree" role="tree" aria-label="Files"> ... </nav>
<summary class="tree-row dir" role="treeitem" aria-expanded="false"> ... </summary>
<button class="tree-row file is-active" role="treeitem" aria-current="true"> ... </button>
```

`aria-expanded` has to be maintained on toggle (`htmx` can do it with
`hx-on::after-request`), so this is a two-file change.

### 2.5 Empty folder

`<li class="tree-empty">empty</li>` renders inside a `.tree-children` div that
expects `div > button` children. Suggest:

```html
<div class="tree-empty" role="treeitem" aria-disabled="true">no files</div>
```

`.tree-empty` is already styled (dim, 12px, 8px padding).

---

## 3. Tabs

### 3.1 Overflow affordance

Tabs scroll (`overflow-x: auto`, hidden scrollbar), but nothing says so. Two
lines of JS in `main.tsx` plus CSS:

```ts
const tabs = document.getElementById('tabs');
const syncOverflow = () => {
  if (!tabs) return;
  tabs.dataset.overflow = String(tabs.scrollWidth > tabs.clientWidth);
};
new ResizeObserver(syncOverflow).observe(tabs!);
document.body.addEventListener('htmx:afterSwap', syncOverflow);
```

```css
.tabs[data-overflow='true'] {
  mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
}
```

A sticky gradient pseudo-element is the alternative if the mask dims the active
tab too much:

```css
.tabs { position: relative; }
.tabs[data-overflow='true']::after {
  content: '';
  position: sticky;
  right: -8px;
  flex: 0 0 24px;
  margin-left: -24px;
  background: linear-gradient(to right, transparent, var(--panel));
  pointer-events: none;
}
```

### 3.2 Dirty dot ↔ close swap

Optional; it is a convention, not a defect. Current CSS shows the dot and the ×
side by side. To swap:

```css
.tab:hover .tab-dirty,
.tab:focus-within .tab-dirty {
  opacity: 0;
}
```

`.tab-dirty` needs `transition: opacity 100ms ease` (add to the existing
transition list) for it not to blink.

### 3.3 Tab affordances beyond click

Needs JS in `main.tsx` (delegated listeners, no markup):

- middle click (`auxclick`, `button === 1`) → `POST /actions/close`
- `Ctrl+W` / `Ctrl+Shift+T` → close / reopen
- `Ctrl+Tab` / `Ctrl+Shift+Tab` → cycle `POST /actions/activate`

The endpoints already exist; only the key handling is missing.

---

## 4. Status bar

### 4.1 Two writers for one segment

`partials/status.html` renders `<span class="status-item" data-role="dirty">`
with the server's unsaved count, and `island.tsx` `flash()` writes "saved" /
"save failed" into the same element. A save flash therefore overwrites the
count until the next htmx refresh.

Split it:

```html
<span class="status-item" data-role="message"></span>
<span class="status-item" data-role="dirty">{% if view.dirty_count > 0 %}{{ view.dirty_count }} unsaved{% endif %}</span>
```

`.status-item:empty { display: none }` is already in place, so both collapse
when empty.

### 4.2 Vim mode as a signal, not a word

```html
<span class="status-item status-mode" data-role="mode" data-mode="normal">normal</span>
```

The island sets `el.dataset.mode = stats.mode` next to `textContent`, then:

```css
.status-mode {
  font-weight: 600;
  letter-spacing: var(--tracking-micro);
  text-transform: uppercase;
}
.status-mode[data-mode='insert'] { color: var(--ok); }
.status-mode[data-mode='visual'] { color: var(--warn); }
.status-mode[data-mode='normal'] { color: var(--fg-muted); }
```

### 4.3 Announcing saves

```html
<span class="status-item" data-role="message" aria-live="polite"></span>
```

Otherwise "saved" is visual only.

---

## 5. Diff view

### 5.1 Semantic status badge

`<span class="pill" id="diff-status">…</span>` is set to plain text by
`island.ts`. With a `data-status` attribute the pill can carry the signal colour:

```html
<span class="pill" id="diff-status" data-status="clean">…</span>
```

```css
.pill[data-status='modified'] { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 35%, var(--border)); }
.pill[data-status='added'] { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 35%, var(--border)); }
.pill[data-status='deleted'] { color: var(--err); border-color: color-mix(in srgb, var(--err) 35%, var(--border)); }
```

`island.ts` sets `status.dataset.status = data.status` before writing text.
Green/red/yellow stay semantic — they never become decoration.

### 5.2 Line counts

```html
<span class="diff-stat" id="diff-stat"></span>
```

```css
.diff-stat {
  flex: 0 0 auto;
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}
.diff-stat .add { color: var(--ok); }
.diff-stat .del { color: var(--err); }
```

The patch is already in the payload, so `+12 −4` is a `for` loop over lines.

### 5.3 Sticky head

`.diff-main` is the scroll container, so this works without markup changes but
needs the head's background to sit above the body:

```css
.diff-head {
  position: sticky;
  top: 0;
  z-index: 2;
  padding-block: var(--sp-1);
  background: var(--bg);
}
.diff-main { padding-top: var(--sp-2); }
```

Left out of `app.css` because the current diff view never scrolls (single
placeholder card); enable it when `@pierre/diffs` renders long files.

---

## 6. Editor

### 6.1 A real empty state

`app.css` ships a last-resort `:empty` fallback:

```css
.editor-island:empty::after { content: 'No buffer open — choose a file in the explorer'; }
```

It only shows if the island never mounts. The editor mounts an empty document
instead, so the intended state needs the CodeMirror extension:

```ts
import { placeholder } from '@codemirror/view';

// createEditor(), inside the extensions array:
placeholder('No buffer open — choose a file in the explorer')
```

A CTA overlay is nicer still:

```html
<div class="editor-empty" id="editor-empty" hidden>
  <p>No buffer open</p>
  <button class="btn outline sm" type="button">New file</button>
</div>
```

```css
.editor-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: var(--sp-3);
  color: var(--dim);
  font-size: var(--fs-sm);
  text-align: center;
}
```

### 6.2 The active line is louder than the chrome

`web/src/editor/theme.ts` takes `editor.lineHighlightBackground` from the Pierre
theme verbatim (`#19283c8c` in dark — a 55% blue band across the full width).
Against the quiet shell it is the loudest thing on screen. Not changed here
because that file belongs to the editor island; suggested:

```ts
const activeLine = c['editor.lineHighlightBackground'] ?? 'transparent';
// soften: the shell's own selected row is --accent at 15%
const activeLineQuiet = 'color-mix(in srgb, #009fff 8%, transparent)';
```

or set `editor.lineHighlightBackground` to `#19283c40` for a band closer to
`.tree-row.is-active`.

---

## 7. Notes from verification (not design, but blocking)

1. **`npm run build` fails on a clean checkout.** `web/src/theme/pierre.ts`
   imports `@pierre/trees`, which is listed in the root `package.json` but not in
   `web/package.json`. Verified by installing it with
   `npm i --no-save --no-package-lock @pierre/trees@1.0.0-beta.6`.
2. **Production CSS 404s.** Vite emits `dist/main.css` (the entry is
   `main.tsx`), but `shell.html` and `diff.html` link `/assets/app.css`; the
   `assetFileNames` rule in `web/vite.config.ts` only rewrites a file named
   `style.css`. Local workaround for verification: `cp dist/main.css
   dist/app.css`. Proper fix: map `main.css` too, or rename the entry.
3. **Dirty state never reaches the server.** `web/src/main.tsx` imports
   `htmx.org` as an ES module, which does not create `window.htmx`; every
   `window.htmx?.ajax(...)` in `web/src/editor/island.tsx` therefore no-ops, so
   `POST /actions/dirty` is never sent while typing and no tab ever shows the
   dirty dot. Fix in `main.tsx`:

   ```ts
   import htmx from 'htmx.org';
   (window as unknown as { htmx: typeof htmx }).htmx = htmx;
   ```

   The dot itself is styled and verified by injecting the same markup the
   partial emits.
