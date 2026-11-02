// Filesystem watch client: `/events` SSE in, fragment refreshes out.
//
// External edits (another editor, git checkout, `cargo fmt`) should show up in
// the tree, tab strip and status bar without a reload. The editor island owns
// its buffer and is deliberately never touched here.

import { htmx } from './htmx';

const RECONNECT_MS = 1500;
const DEBOUNCE_MS = 180;

/** The watcher labels a burst `structure` only when it can change the tree. */
const STRUCTURE = 'structure';

export function setupWatch() {
  if (typeof EventSource === 'undefined') return;

  let source: EventSource | null = null;
  let reconnect: number | undefined;
  let refreshTimer: number | undefined;
  let structural = false;
  let closed = false;

  const refresh = () => {
    refreshTimer = undefined;
    if (closed || document.hidden) return;
    const api = htmx();
    if (!api) return;
    // Writing a buffer's contents cannot change the tree, and every tree swap
    // is a full fragment round-trip; only adds, removals and renames refresh
    // the explorer. Tabs and status follow every change.
    if (structural) api.trigger(document.body, 'we:tree');
    structural = false;
    void api.ajax('GET', '/fragments/tabs', {
      source: document.body,
      target: '#tabs',
      swap: 'innerHTML',
    });
    void api.ajax('GET', '/fragments/status', {
      source: document.body,
      target: '#status',
      swap: 'innerHTML',
    });
  };

  const schedule = () => {
    if (refreshTimer !== undefined) return;
    refreshTimer = window.setTimeout(refresh, DEBOUNCE_MS);
  };

  const queue = (kind: string) => {
    if (kind === STRUCTURE) structural = true;
    schedule();
  };

  const connect = () => {
    if (closed) return;
    source = new EventSource('/events');
    source.addEventListener('fs', (event) => queue((event as MessageEvent<string>).data));
    source.addEventListener('error', () => {
      // EventSource retries on its own, but a restarted server leaves it dead
      // often enough that closing and reopening is the more reliable loop.
      source?.close();
      source = null;
      window.clearTimeout(reconnect);
      reconnect = window.setTimeout(connect, RECONNECT_MS);
    });
  };

  // Catch up on changes that happened while the page was in the background;
  // structural ones may have been missed entirely, so refresh the tree too.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    structural = true;
    schedule();
  });

  window.addEventListener('beforeunload', () => {
    closed = true;
    window.clearTimeout(refreshTimer);
    window.clearTimeout(reconnect);
    source?.close();
  });

  connect();
}
