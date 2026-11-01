// The chrome: palette entry points, global shortcuts, sidebar collapse.
//
// One keydown listener owns every app-level chord. It runs in the capture
// phase so chords win over CodeMirror/vim keymaps, but it deliberately leaves
// Ctrl+S alone — saving belongs to the editor island.

import './chrome.css';

import { closePalette, isPaletteOpen, openPalette } from './palette';
import { applySidebar, readSidebar, toggleSidebar } from './sidebar';
import { setupWatch } from './watch';

export function setupChrome() {
  // Diff pages have no sidebar; leave them untouched.
  if (!document.getElementById('sidebar')) return;

  applySidebar(readSidebar());
  installShortcuts();
  setupWatch();

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    if (target.closest('[data-sidebar-toggle]')) {
      toggleSidebar();
      return;
    }

    const opener = target.closest<HTMLElement>('[data-palette-open]');
    if (opener) {
      const mode = opener.dataset.paletteOpen === 'commands' ? 'commands' : 'files';
      openPalette(mode);
    }
  });
}

function installShortcuts() {
  window.addEventListener('keydown', onKey, true);
}

function onKey(event: KeyboardEvent) {
  if (event.repeat || event.isComposing) return;

  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;

  if (key === 'escape') {
    if (isPaletteOpen()) {
      intercept(event);
      closePalette();
    }
    return;
  }

  if (!mod || event.altKey) return;

  if (key === 'p') {
    intercept(event);
    openPalette(event.shiftKey ? 'commands' : 'files');
    return;
  }

  if (key === 'b' && !event.shiftKey) {
    intercept(event);
    toggleSidebar();
    return;
  }

  // Works in the desktop shell; browsers reserve the chord and may close the tab.
  if (key === 'w' && !event.shiftKey) {
    const path = document.getElementById('editor')?.dataset.path ?? '';
    if (!path) return;
    intercept(event);
    window.htmx?.ajax('POST', '/actions/close', {
      source: document.body,
      target: '#tabs',
      swap: 'innerHTML',
      values: { path },
    });
    return;
  }

  // Ctrl+S belongs to the editor; never shadow it here.
}

function intercept(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
}
