// The chrome: palette entry points, global shortcuts, sidebar collapse.
//
// One keydown listener owns every app-level chord. It runs in the capture
// phase so chords win over CodeMirror/vim keymaps, but it deliberately leaves
// Ctrl+S alone — saving belongs to the editor island.

import './chrome.css';

import { closePalette, isPaletteOpen, openPalette } from './palette';
import { applySidebar, readSidebar, toggleSidebar } from './sidebar';

const ICONS = {
  // Two states of the same control: a panel with a divider, and a panel with a
  // caret pointing into the content ("bring it back").
  sidebarOpen:
    '<svg class="icon-sidebar-open" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25"/><path d="M6 2.75v10.5"/></svg>',
  sidebarShow:
    '<svg class="icon-sidebar-show" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25"/><path d="m4.4 5.9 2.1 2.1-2.1 2.1"/></svg>',
  search:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3 3"/></svg>',
};

export function setupChrome() {
  // Diff pages have no sidebar; leave them untouched.
  if (!document.getElementById('sidebar')) return;

  installTitlebar();
  applySidebar(readSidebar());
  installShortcuts();

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

function installTitlebar() {
  const titlebar = document.querySelector<HTMLElement>('.titlebar');
  if (!titlebar || titlebar.querySelector('[data-sidebar-toggle]')) return;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn sm chrome-btn';
  toggle.dataset.sidebarToggle = 'true';
  toggle.setAttribute('aria-controls', 'sidebar');
  toggle.setAttribute('aria-expanded', 'true');
  toggle.title = 'Hide sidebar (Ctrl B)';
  toggle.setAttribute('aria-label', 'Hide sidebar');
  toggle.innerHTML = `<span class="chrome-icon">${ICONS.sidebarOpen}${ICONS.sidebarShow}</span>`;

  const brand = titlebar.querySelector('.brand');
  if (brand?.nextSibling) titlebar.insertBefore(toggle, brand.nextSibling);
  else titlebar.prepend(toggle);

  // A visible palette affordance, centered in the bar, so the shortcut is
  // discoverable without a keyboard.
  const search = document.createElement('button');
  search.type = 'button';
  search.className = 'btn chrome-search';
  search.dataset.paletteOpen = 'files';
  search.title = 'Search files (Ctrl P) · commands (Ctrl Shift P)';
  search.innerHTML = `<span class="chrome-icon">${ICONS.search}</span><span class="chrome-search-label">Search files</span><kbd>Ctrl P</kbd>`;

  const themeToggle = titlebar.querySelector('#theme-toggle');
  if (themeToggle) {
    const tail = document.createElement('div');
    tail.className = 'spacer';
    titlebar.insertBefore(tail, themeToggle);
    titlebar.insertBefore(search, tail);
  } else {
    titlebar.append(search);
  }
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

  // Ctrl+W / Ctrl+S belong to the editor; never shadow them here.
}

function intercept(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
}
