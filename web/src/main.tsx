import './styles/app.css';
import htmx from 'htmx.org';

import { render } from 'solid-js/web';

import { EditorIsland } from './editor/island';
import { mountDiff } from './diff/island';
import { setupTheme } from './theme';

declare global {
  interface Window {
    htmx?: typeof htmx;
  }
}

// The ESM build does not attach itself to `window`; the islands rely on the
// global for out-of-band chrome updates.
window.htmx = htmx;

setupTheme();

// The tree is server-rendered and only refreshes on demand; keep its active
// marker in step with the buffer the islands just opened.
document.addEventListener('we:open', (event) => {
  const path = (event as CustomEvent<{ path?: string }>).detail?.path ?? '';
  for (const row of document.querySelectorAll<HTMLElement>('.tree-row.is-active')) {
    row.classList.remove('is-active');
  }
  if (!path) return;
  for (const row of document.querySelectorAll<HTMLElement>('.tree-row.file')) {
    if (row.dataset.path === path) {
      row.classList.add('is-active');
      break;
    }
  }
});

function boot() {
  const editorRoot = document.getElementById('editor-island');
  if (editorRoot && !editorRoot.dataset.mounted) {
    editorRoot.dataset.mounted = 'true';
    render(() => <EditorIsland />, editorRoot);
  }

  const diffRoot = document.getElementById('diff-body');
  if (diffRoot && !diffRoot.dataset.mounted) {
    diffRoot.dataset.mounted = 'true';
    void mountDiff(diffRoot);
  }
}

boot();
