// Main-thread front for the highlighting worker.
//
// Results are cached by (theme, lang, code) in an LRU map and identical
// in-flight requests are coalesced, so typing in one fence only re-highlights
// that fence once the preview debounce fires. Until a result arrives the
// preview keeps the plain escaped <pre>, which is the graceful fallback.

export type HighlightTheme = 'dark' | 'light';

type Reply = { id: number; html?: string; error?: string };

const CACHE_LIMIT = 240;

export type CodeHighlighter = {
  /** Synchronous cache lookup; undefined when not highlighted yet. */
  get: (lang: string, code: string, theme: HighlightTheme) => string | undefined;
  /** Resolves to highlighted HTML, or null when highlighting failed. */
  highlight: (lang: string, code: string, theme: HighlightTheme) => Promise<string | null>;
  destroy: () => void;
};

function keyOf(lang: string, code: string, theme: HighlightTheme): string {
  return `${theme}\u0000${lang}\u0000${code}`;
}

export function createCodeHighlighter(): CodeHighlighter {
  const cache = new Map<string, string>();
  const waiters = new Map<string, Array<(html: string | null) => void>>();
  const pending = new Map<number, string>();
  let worker: Worker | null = null;
  let failed = false;
  let sequence = 0;

  const remember = (key: string, html: string) => {
    cache.delete(key);
    cache.set(key, html);
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const settle = (key: string, html: string | null) => {
    const list = waiters.get(key);
    if (!list) return;
    waiters.delete(key);
    for (const resolve of list) resolve(html);
  };

  const fail = () => {
    failed = true;
    worker?.terminate();
    worker = null;
    pending.clear();
    for (const key of [...waiters.keys()]) settle(key, null);
  };

  const ensureWorker = (): Worker | null => {
    if (failed) return null;
    if (worker) return worker;
    try {
      worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), {
        type: 'module',
        name: 'we-highlight',
      });
      worker.onmessage = (event: MessageEvent<Reply>) => {
        const { id, html } = event.data;
        const key = pending.get(id);
        if (!key) return;
        pending.delete(id);
        if (html) remember(key, html);
        settle(key, html ?? null);
      };
      worker.onerror = () => fail();
      worker.onmessageerror = () => fail();
    } catch {
      failed = true;
      worker = null;
    }
    return worker;
  };

  return {
    get: (lang, code, theme) => {
      const key = keyOf(lang, code, theme);
      const hit = cache.get(key);
      if (hit === undefined) return undefined;
      // LRU bump.
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    },
    highlight: (lang, code, theme) => {
      const key = keyOf(lang, code, theme);
      const hit = cache.get(key);
      if (hit !== undefined) {
        cache.delete(key);
        cache.set(key, hit);
        return Promise.resolve(hit);
      }
      return new Promise<string | null>((resolve) => {
        const list = waiters.get(key);
        if (list) {
          list.push(resolve);
          return;
        }
        waiters.set(key, [resolve]);
        const instance = ensureWorker();
        if (!instance) {
          settle(key, null);
          return;
        }
        sequence += 1;
        pending.set(sequence, key);
        instance.postMessage({ id: sequence, code, lang, theme });
      });
    },
    destroy: () => {
      failed = true;
      for (const key of [...waiters.keys()]) settle(key, null);
      worker?.terminate();
      worker = null;
      pending.clear();
      cache.clear();
    },
  };
}
