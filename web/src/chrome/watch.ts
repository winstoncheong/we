// Filesystem watch client: `/events` SSE in, fragment refreshes out.
//
// External edits (another editor, git checkout, `cargo fmt`) should show up in
// the tree, tab strip and status bar without a reload. The editor island owns
// its buffer and is deliberately never touched here.

import { htmx } from './htmx';

const RECONNECT_MS = 1500;
const DEBOUNCE_MS = 180;

export function setupWatch() {
  if (typeof EventSource === 'undefined') return;

  let source: EventSource | null = null;
  let reconnect: number | undefined;
  let refreshTimer: number | undefined;
  let closed = false;

  const refresh = () => {
    refreshTimer = undefined;
    if (closed || document.hidden) return;
    const api = htmx();
    if (!api) return;
    // The tree takes its own trigger so expansion state stays its business.
    api.trigger(document.body, 'we:tree');
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

  const queue = () => {
    if (refreshTimer !== undefined) return;
    refreshTimer = window.setTimeout(refresh, DEBOUNCE_MS);
  };

  const connect = () => {
    if (closed) return;
    source = new EventSource('/events');
    source.addEventListener('fs', queue);
    source.addEventListener('error', () => {
      // EventSource retries on its own, but a restarted server leaves it dead
      // often enough that closing and reopening is the more reliable loop.
      source?.close();
      source = null;
      window.clearTimeout(reconnect);
      reconnect = window.setTimeout(connect, RECONNECT_MS);
    });
  };

  // Catch up on changes that happened while the page was in the background.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) queue();
  });

  window.addEventListener('beforeunload', () => {
    closed = true;
    window.clearTimeout(refreshTimer);
    window.clearTimeout(reconnect);
    source?.close();
  });

  connect();
}
