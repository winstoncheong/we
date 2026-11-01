import './styles/app.css';
// The ESM build of htmx does not publish `window.htmx`, but the shell's
// fragments, the islands and the chrome all reach for it (htmx.ajax/process).
// Bind it explicitly before anything mounts.
import htmx from 'htmx.org';

import { render } from 'solid-js/web';

import { setupChrome } from './chrome';
import { EditorIsland } from './editor/island';
import { mountDiff } from './diff/island';
import { setupTheme } from './theme';

declare global {
  interface Window {
    htmx?: typeof htmx;
  }
}

window.htmx = htmx;

setupTheme();
setupChrome();

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
