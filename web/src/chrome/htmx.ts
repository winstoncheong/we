// Thin typed access to the htmx runtime the shell loads.
//
// The chunk is loaded by main.tsx (`import 'htmx.org'`), which attaches
// `window.htmx`. We never depend on it being present: chrome must degrade to
// read-only rather than throw.

export type HtmxApi = {
  ajax: (verb: string, path: string, options?: Record<string, unknown>) => Promise<unknown>;
  trigger: (element: Element | string, event: string) => void;
  process?: (element: Element) => void;
};

export function htmx(): HtmxApi | undefined {
  return (window as unknown as { htmx?: HtmxApi }).htmx;
}

/**
 * POST a form-shaped action and let htmx swap the tab strip (the response also
 * carries an out-of-band status bar, so nothing else needs wiring).
 */
export function action(path: string, values: Record<string, string>) {
  return htmx()?.ajax('POST', path, {
    source: document.body,
    target: '#tabs',
    swap: 'innerHTML',
    values,
  });
}

/** The buffer currently shown, from the server-rendered shell markers. */
export function activePath(): string {
  const tab = document.querySelector<HTMLElement>('.tab.is-active');
  if (tab?.dataset.path) return tab.dataset.path;
  return document.getElementById('editor')?.dataset.path ?? '';
}
