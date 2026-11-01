// Full-screen diff view. The server hands us both file versions, git status and
// a coarse "kind"; @pierre/diffs does the rendering. The library itself is
// loaded lazily so the editor never pays for it.

import './diff.css';

import { currentTheme } from '../theme';
import {
  buildFileDiff,
  createDiffRenderer,
  loadDiffLibrary,
  type DiffLayout,
  type DiffRenderer,
} from './renderer';

const LAYOUT_KEY = 'we:diff-layout';

/** How long the first painted diff line may take before we call it stalled. */
const RENDER_WATCHDOG_MS = 10_000;

type DiffKind = 'modified' | 'untracked' | 'clean' | 'no-repo' | 'binary' | 'too-large' | 'error';

type DiffPayload = {
  path: string;
  status: string;
  patch: string;
  original: string;
  current: string;
  message: string;
  is_repo: boolean;
  kind: DiffKind;
  additions: number;
  deletions: number;
};

/** Porcelain status codes → the words the header pill shows. */
const STATUS_WORDS: Record<string, string> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'conflicted',
  T: 'type changed',
  '??': 'untracked',
  '!!': 'ignored',
};

const KIND_WORDS: Partial<Record<DiffKind, string>> = {
  clean: 'clean',
  'no-repo': 'no repo',
  binary: 'binary',
  'too-large': 'too large',
  error: 'git error',
};

function readLayout(): DiffLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'split' ? 'split' : 'unified';
  } catch {
    return 'unified';
  }
}

function writeLayout(layout: DiffLayout) {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    /* private mode */
  }
}

function statusWord(payload: DiffPayload): string {
  // Empty states are about the *file*, not the index: say "binary" rather than
  // "untracked" when both are true.
  if (payload.kind !== 'modified' && payload.kind !== 'untracked' && KIND_WORDS[payload.kind]) {
    return KIND_WORDS[payload.kind] ?? payload.kind;
  }
  const code = payload.status;
  if (code === '') return KIND_WORDS[payload.kind] ?? 'unknown';
  // `AM` / `MM` style codes: the index character is the interesting one.
  const word = STATUS_WORDS[code] ?? STATUS_WORDS[code.charAt(0)];
  return word ?? KIND_WORDS[payload.kind] ?? 'changed';
}

function paintHeader(payload: DiffPayload) {
  const pill = document.getElementById('diff-status');
  if (pill != null) pill.textContent = statusWord(payload);

  const meta = document.getElementById('diff-meta');
  if (meta == null) return;
  meta.replaceChildren();
  if (payload.additions > 0) {
    const added = document.createElement('span');
    added.className = 'diff-count is-add';
    added.textContent = `+${payload.additions}`;
    meta.append(added);
  }
  if (payload.deletions > 0) {
    const removed = document.createElement('span');
    removed.className = 'diff-count is-del';
    removed.textContent = `-${payload.deletions}`;
    meta.append(removed);
  }
}

type EmptyState = {
  icon: string;
  title: string;
  body: string;
  meta?: string;
};

function emptyState(payload: DiffPayload): EmptyState {
  const meta = payload.status ? `git status ${payload.status}` : undefined;
  switch (payload.kind) {
    case 'no-repo':
      return {
        icon: '∅',
        title: 'Not a git repository',
        body: 'This workspace is not tracked by git, so there is nothing to compare. Open a folder that contains a .git directory to see diffs.',
      };
    case 'clean':
      return {
        icon: '✓',
        title: 'No changes',
        body: 'This file matches the last commit. Edit it in the editor and save to see a diff here.',
        meta,
      };
    case 'binary':
      return {
        icon: '01',
        title: 'Binary file',
        body: 'This file is not text, so it cannot be shown as a line diff.',
        meta,
      };
    case 'too-large':
      return {
        icon: '…',
        title: 'Too large to diff',
        body: payload.message || 'This file is past the size the diff view will render.',
        meta,
      };
    case 'error':
      return {
        icon: '!',
        title: 'Git could not produce a diff',
        body: payload.message || 'The git command failed; the workspace may be in an unusual state.',
        meta,
      };
    default:
      return {
        icon: '∅',
        title: 'Nothing to show',
        body: payload.message || 'This file has no line changes.',
        meta,
      };
  }
}

function showEmpty(container: HTMLElement, state: EmptyState) {
  const wrapper = document.createElement('div');
  wrapper.className = 'diff-empty';

  const icon = document.createElement('div');
  icon.className = 'diff-empty-icon';
  icon.textContent = state.icon;

  const title = document.createElement('div');
  title.className = 'diff-empty-title';
  title.textContent = state.title;

  const body = document.createElement('div');
  body.className = 'diff-empty-body';
  body.textContent = state.body;

  wrapper.append(icon, title, body);
  if (state.meta != null) {
    const meta = document.createElement('div');
    meta.className = 'diff-empty-meta';
    meta.textContent = state.meta;
    wrapper.append(meta);
  }

  container.classList.add('is-empty');
  container.replaceChildren(wrapper);
}

function showLoading(container: HTMLElement, label: string) {
  const placeholder = document.createElement('div');
  placeholder.className = 'diff-placeholder';
  placeholder.textContent = label;
  container.classList.add('is-empty');
  container.replaceChildren(placeholder);
}

/** Split / Stacked control; radiogroup semantics with arrow-key support. */
function bindLayout(onChange: (layout: DiffLayout) => void) {
  const control = document.getElementById('diff-layout');
  if (control == null) return;

  const paint = (layout: DiffLayout) => {
    for (const button of control.querySelectorAll<HTMLButtonElement>('[data-layout]')) {
      const active = button.dataset.layout === layout;
      button.setAttribute('aria-checked', String(active));
      button.tabIndex = active ? 0 : -1;
    }
  };
  paint(readLayout());

  const choose = (layout: DiffLayout) => {
    paint(layout);
    writeLayout(layout);
    onChange(layout);
  };

  control.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-layout]');
    if (button == null) return;
    choose(button.dataset.layout === 'split' ? 'split' : 'unified');
  });

  control.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const buttons = [...control.querySelectorAll<HTMLButtonElement>('[data-layout]')];
    const current = buttons.findIndex((button) => button.getAttribute('aria-checked') === 'true');
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = buttons[(current + step + buttons.length) % buttons.length];
    if (next == null) return;
    event.preventDefault();
    next.focus();
    choose(next.dataset.layout === 'split' ? 'split' : 'unified');
  });
}

async function fetchPayload(path: string): Promise<DiffPayload> {
  const response = await fetch(`/api/diff?path=${encodeURIComponent(path)}`);
  if (!response.ok) throw new Error(`server answered ${response.status}`);
  return (await response.json()) as DiffPayload;
}

export async function mountDiff(container: HTMLElement) {
  const path = container.dataset.path ?? '';
  let layout = readLayout();
  let renderer: DiffRenderer | null = null;

  bindLayout((next) => {
    layout = next;
    renderer?.setLayout(next);
  });

  document.addEventListener('we:theme', () => {
    renderer?.setTheme(currentTheme());
  });

  let payload: DiffPayload;
  try {
    payload = await fetchPayload(path);
  } catch (error) {
    showEmpty(container, {
      icon: '!',
      title: 'Could not load the diff',
      body: error instanceof Error ? error.message : 'The server did not answer.',
    });
    return;
  }

  paintHeader(payload);

  if (payload.kind !== 'modified' && payload.kind !== 'untracked') {
    showEmpty(container, emptyState(payload));
    return;
  }

  showLoading(container, 'loading diff…');

  let library: Awaited<ReturnType<typeof loadDiffLibrary>>;
  try {
    library = await loadDiffLibrary();
  } catch (error) {
    console.error('[we] @pierre/diffs failed to load', error);
    showEmpty(container, {
      icon: '!',
      title: 'Diff renderer unavailable',
      body: 'The diff library could not be loaded. Rebuild the web bundle (npm run build) and reload.',
    });
    return;
  }

  const fileDiff = buildFileDiff(library, {
    path,
    original: payload.kind === 'untracked' ? null : payload.original,
    current: payload.current,
    patch: payload.patch,
  });

  if (fileDiff == null) {
    showEmpty(container, {
      icon: '✓',
      title: 'No line changes',
      body: payload.message || 'The two versions are identical.',
    });
    return;
  }

  // The panel scrolls, not the page: the virtualizer needs one scroll root.
  container.classList.remove('is-empty');
  const host = document.createElement('div');
  host.className = 'diff-host';
  container.replaceChildren(host);

  let created: DiffRenderer | null = null;
  try {
    created = createDiffRenderer(library, host, container, { layout, theme: currentTheme() });
    renderer = created;
    created.show(fileDiff);
  } catch (error) {
    console.error('[we] diff render failed', error);
    try {
      created?.cleanUp();
    } catch {
      /* already torn down */
    }
    renderer = null;
    showEmpty(container, {
      icon: '!',
      title: 'Could not render this diff',
      body: error instanceof Error ? error.message : 'The renderer threw while drawing the file.',
    });
    return;
  }

  // Highlighting resolves asynchronously (Shiki chunks load on demand), and a
  // failure there is silent: the instance can hold an empty <pre> forever. Watch
  // for real rows so the page never sits blank without an explanation.
  const started = Date.now();
  const watchdog = window.setInterval(() => {
    if (!container.isConnected) {
      window.clearInterval(watchdog);
      return;
    }
    const painted =
      (host.querySelector('diffs-container')?.shadowRoot?.querySelectorAll('[data-line]').length ??
        0) > 0;
    if (painted || Date.now() - started > RENDER_WATCHDOG_MS) {
      window.clearInterval(watchdog);
      if (painted) return;
      try {
        created?.cleanUp();
      } catch {
        /* already torn down */
      }
      renderer = null;
      showEmpty(container, {
        icon: '!',
        title: 'The diff did not finish rendering',
        body: 'The renderer never painted its first line. Rebuild the web bundle (npm run build) and reload; the assets must be served under /assets.',
      });
    }
  }, 250);
}
