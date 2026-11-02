// Quick-open / command palette controller.
//
// The markup is server-rendered (partials/palette.html) and htmx owns the
// results list. This module only opens/closes the shell, keeps a highlighted
// row in sync while the user types, and dispatches the selected row.

import { runCommand } from './commands';
import { action, htmx } from './htmx';

export type PaletteMode = 'files' | 'commands';

let root: HTMLDivElement | null = null;
let host: HTMLElement | null = null;
let mode: PaletteMode | null = null;
let opener: HTMLElement | null = null;
let activeIndex = 0;
let generation = 0;

/// Poll cadence while the server is still indexing a big workspace.
const INDEX_RETRY_MS = 600;
const INDEX_RETRY_MAX_MS = 4000;
const INDEX_RETRY_LIMIT = 20;

let retryTimer: number | undefined;
let retryCount = 0;

export function isPaletteOpen(): boolean {
  return Boolean(root && !root.hidden);
}

export function openPalette(next: PaletteMode) {
  ensureRoot();
  if (!root || !host) return;

  if (isPaletteOpen() && mode === next) {
    host.querySelector<HTMLInputElement>('#palette-input')?.focus();
    // Reopening is also a retry: the index may have finished since.
    retryCount = 0;
    retryWhenIndexing();
    return;
  }

  const wasOpen = isPaletteOpen();
  if (!wasOpen) opener = document.activeElement as HTMLElement | null;
  mode = next;
  activeIndex = 0;
  retryCount = 0;
  stopRetry();
  const ticket = ++generation;

  root.hidden = false;
  host.innerHTML = '<div class="palette-loading">loading…</div>';

  void (async () => {
    let html: string;
    try {
      const response = await fetch(`/fragments/palette?mode=${next}`, {
        headers: { 'HX-Request': 'true' },
      });
      if (!response.ok) throw new Error(String(response.status));
      html = await response.text();
    } catch {
      if (ticket === generation) {
        host!.innerHTML = '<div class="palette-empty">palette unavailable</div>';
      }
      return;
    }
    if (ticket !== generation) return;

    host!.innerHTML = html;
    htmx()?.process?.(host!);
    activeIndex = 0;
    syncActive(false);
    host!.querySelector<HTMLInputElement>('#palette-input')?.focus();
    retryWhenIndexing();
  })();
}

/** A huge workspace indexes in the background; ask again until it is ready. */
function retryWhenIndexing() {
  stopRetry();
  if (!isPaletteOpen() || !mode) return;
  if (!host?.querySelector('#palette-results [data-indexing]')) return;
  if (retryCount >= INDEX_RETRY_LIMIT) return;

  const delay = Math.min(INDEX_RETRY_MS * 2 ** retryCount, INDEX_RETRY_MAX_MS);
  retryCount += 1;
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    const input = host?.querySelector<HTMLInputElement>('#palette-input');
    if (!isPaletteOpen() || !mode || !input) return;
    const params = new URLSearchParams({
      mode,
      q: input.value,
      results_only: '1',
    });
    void htmx()?.ajax('GET', `/fragments/palette?${params}`, {
      target: '#palette-results',
      swap: 'innerHTML',
    });
  }, delay);
}

function stopRetry() {
  if (retryTimer === undefined) return;
  window.clearTimeout(retryTimer);
  retryTimer = undefined;
}

export function closePalette() {
  if (!isPaletteOpen() || !root || !host) return;
  generation += 1;
  stopRetry();
  retryCount = 0;
  root.hidden = true;
  host.innerHTML = '';
  mode = null;
  activeIndex = 0;

  const target = opener;
  opener = null;
  if (target && target.isConnected && target !== document.body) {
    target.focus({ preventScroll: true });
  } else {
    // Fall back to the editor so Esc never leaves focus on <body>.
    document.querySelector<HTMLElement>('.cm-content')?.focus({ preventScroll: true });
  }
}

/** Move the highlighted row; wraps around, never needs a round-trip. */
export function moveActive(delta: number) {
  const rows = listRows();
  if (rows.length === 0) return;
  activeIndex = (activeIndex + delta + rows.length) % rows.length;
  syncActive();
}

export function activateActive() {
  const rows = listRows();
  const row = rows[activeIndex];
  if (row) activate(row);
}

export function resetActive() {
  activeIndex = 0;
  syncActive(false);
}

function listRows(): HTMLElement[] {
  return host ? Array.from(host.querySelectorAll<HTMLElement>('.palette-row')) : [];
}

function syncActive(scroll = true) {
  const rows = listRows();
  if (rows.length === 0) return;
  if (activeIndex >= rows.length) activeIndex = 0;
  rows.forEach((row, index) => {
    const active = index === activeIndex;
    row.classList.toggle('is-active', active);
    row.setAttribute('aria-selected', String(active));
  });
  if (!scroll) return;
  const row = rows[activeIndex];
  row?.scrollIntoView({ block: 'nearest' });
  const input = host?.querySelector<HTMLInputElement>('#palette-input');
  if (row?.id && input) input.setAttribute('aria-activedescendant', row.id);
}

function activate(row: HTMLElement) {
  if (row.dataset.disabled === 'true') return;

  if (row.dataset.kind === 'file') {
    const path = row.dataset.path ?? '';
    closePalette();
    if (!path) return;
    void action('/actions/open', { path });
    return;
  }

  const command = row.dataset.command ?? '';
  closePalette();
  runCommand(command);
}

function ensureRoot(): void {
  if (root) return;

  root = document.createElement('div');
  root.id = 'palette-root';
  root.className = 'palette-root';
  root.hidden = true;

  const scrim = document.createElement('div');
  scrim.className = 'palette-scrim';
  scrim.dataset.paletteDismiss = 'true';

  host = document.createElement('div');
  host.className = 'palette-host';

  root.append(scrim, host);
  document.body.append(root);

  // Clicking the scrim dismisses; clicking a row runs it.
  root.addEventListener('mousedown', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-palette-dismiss]')) closePalette();
  });

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('.palette-row');
    if (row) activate(row);
  });

  // Arrow/Enter/Home/End must work with focus inside the input.
  root.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'PageDown':
        event.preventDefault();
        moveActive(8);
        break;
      case 'PageUp':
        event.preventDefault();
        moveActive(-8);
        break;
      case 'Home': {
        event.preventDefault();
        const length = listRows().length;
        if (length) {
          activeIndex = 0;
          syncActive();
        }
        break;
      }
      case 'End': {
        event.preventDefault();
        const length = listRows().length;
        if (length) {
          activeIndex = length - 1;
          syncActive();
        }
        break;
      }
      case 'Enter':
        event.preventDefault();
        activateActive();
        break;
      default:
        break;
    }
  });

  // Typing starts a new query, so give the background index a fresh budget.
  root.addEventListener('input', () => {
    retryCount = 0;
  });

  // htmx replaced the results list: highlight the best hit again.
  root.addEventListener('htmx:afterSwap', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target || target.id !== 'palette-results') return;
    resetActive();
    retryWhenIndexing();
  });
}
