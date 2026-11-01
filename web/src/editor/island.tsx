import { onCleanup, onMount } from 'solid-js';

import { createEditor, type Editor } from './createEditor';
import { getTheme } from '../theme/pierre';
import { currentTheme, token } from '../theme';
import { isMarkdownPath } from '../preview/paths';
import { createPreviewPane, type PreviewPane } from '../preview/pane';
import { createScrollSync, type ScrollSync } from '../preview/sync';
import { createSplitLayout, type SplitLayout } from '../preview/split';

const VIM_KEY = 'we:vim';
const PREVIEW_KEY = 'we:preview';
const PREVIEW_RATIO_KEY = 'we:preview:ratio';

function vimEnabled(): boolean {
  try {
    return localStorage.getItem(VIM_KEY) !== 'false';
  } catch {
    return true;
  }
}

function previewWanted(): boolean {
  try {
    return localStorage.getItem(PREVIEW_KEY) === 'on';
  } catch {
    return false;
  }
}

function rememberPreview(on: boolean) {
  try {
    localStorage.setItem(PREVIEW_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode */
  }
}

function storedRatio(): number {
  try {
    const value = Number(localStorage.getItem(PREVIEW_RATIO_KEY));
    return Number.isFinite(value) && value > 0.1 && value < 0.9 ? value : 0.5;
  } catch {
    return 0.5;
  }
}

function rememberRatio(ratio: number) {
  try {
    localStorage.setItem(PREVIEW_RATIO_KEY, String(ratio));
  } catch {
    /* private mode */
  }
}

function setStatus(role: string, text: string) {
  const el = document.querySelector(`[data-role="${role}"]`);
  if (el && el.textContent !== text) el.textContent = text;
}

function postDirty(path: string, dirty: boolean) {
  window.htmx?.ajax('POST', '/actions/dirty', {
    source: document.body,
    target: '#tabs',
    swap: 'innerHTML',
    values: { path, dirty },
  });
}

export function EditorIsland() {
  let host!: HTMLDivElement;
  let splitHost!: HTMLDivElement;
  let divider!: HTMLDivElement;
  let previewHost!: HTMLDivElement;
  let toggleBtn!: HTMLButtonElement;
  let editor: Editor | undefined;
  let split: SplitLayout | undefined;
  let preview: PreviewPane | undefined;
  let sync: ScrollSync | undefined;
  let dirtyTimer: number | undefined;
  let messageTimer: number | undefined;
  let dirty = false;
  let currentPath = '';
  let wantPreview = previewWanted();

  const appTheme = () =>
    getTheme(currentTheme() === 'dark' ? 'pierre-dark' : 'pierre-light');

  const flushDirty = () => {
    window.clearTimeout(dirtyTimer);
    if (dirty && currentPath) postDirty(currentPath, true);
  };

  const markDirty = () => {
    if (dirty) return;
    dirty = true;
    window.clearTimeout(dirtyTimer);
    dirtyTimer = window.setTimeout(() => {
      if (currentPath) postDirty(currentPath, true);
    }, 350);
  };

  const flash = (text: string) => {
    setStatus('dirty', text);
    window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => setStatus('dirty', ''), 1400);
  };

  const save = async () => {
    if (!editor || !currentPath) return;
    const body = editor.text();
    const response = await fetch(`/api/file?path=${encodeURIComponent(currentPath)}`, {
      method: 'PUT',
      headers: { 'X-We-Token': token() },
      body,
    });
    if (response.ok) {
      dirty = false;
      window.clearTimeout(dirtyTimer);
      postDirty(currentPath, false);
      flash('saved');
    } else {
      flash('save failed');
    }
  };

  /** Sync the split, the toggle chip and the preview to the active buffer. */
  const applyPreview = () => {
    if (!split || !preview || !sync || !editor) return;
    const markdown = isMarkdownPath(currentPath);
    const on = markdown && wantPreview;

    toggleBtn.hidden = !markdown;
    toggleBtn.classList.toggle('is-on', on);
    toggleBtn.setAttribute('aria-pressed', String(on));
    toggleBtn.title = on
      ? 'Hide Markdown preview (Ctrl+Shift+V)'
      : 'Show Markdown preview (Ctrl+Shift+V)';

    split.setEnabled(on);
    preview.setPath(currentPath);
    preview.setEnabled(on);
    sync.setEnabled(on);
    document
      .getElementById('editor')
      ?.setAttribute('data-markdown', String(markdown));

    if (on) {
      preview.update(editor.text());
      requestAnimationFrame(() => sync?.syncFrom('editor'));
    }
  };

  const togglePreview = (enabled?: boolean) => {
    if (!isMarkdownPath(currentPath)) return;
    const next = enabled ?? !wantPreview;
    if (next === wantPreview) return;
    wantPreview = next;
    rememberPreview(next);
    applyPreview();
  };

  const load = async (path: string) => {
    if (!editor) return;
    if (!path) {
      currentPath = '';
      document.getElementById('editor')?.removeAttribute('data-path');
      applyPreview();
      return;
    }
    if (path === currentPath) return;
    const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    if (!response.ok) {
      flash('cannot open');
      return;
    }
    const text = await response.text();
    currentPath = path;
    dirty = false;
    window.clearTimeout(dirtyTimer);
    editor.open(path, text);
    document.getElementById('editor')?.setAttribute('data-path', path);
    applyPreview();
  };

  onMount(() => {
    editor = createEditor(host, {
      path: '',
      doc: '',
      theme: appTheme(),
      vim: vimEnabled(),
      onChange: (text) => {
        markDirty();
        if (isMarkdownPath(currentPath)) preview?.schedule(text);
      },
      onStats: (stats) => {
        setStatus('cursor', `ln ${stats.line}, col ${stats.col}`);
        setStatus('mode', stats.mode);
      },
    });

    split = createSplitLayout({
      root: splitHost,
      divider,
      initialRatio: storedRatio(),
      onRatioChange: rememberRatio,
    });
    preview = createPreviewPane(previewHost);
    sync = createScrollSync({
      view: () => editor?.view(),
      preview: () => preview?.scroller() ?? null,
    });

    const initial = document.getElementById('editor')?.dataset.path ?? '';
    if (initial) void load(initial);
    else applyPreview();

    const onOpen = (event: Event) => {
      const path = (event as CustomEvent<{ path?: string }>).detail?.path ?? '';
      if (path === currentPath) return;
      // Newest selection wins; drop pending dirty writes for the old buffer.
      window.clearTimeout(dirtyTimer);
      void load(path);
      if (!path) setStatus('mode', '');
    };

    const onTheme = () => editor?.setTheme(appTheme());

    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };

    // Ctrl/Cmd+Shift+V toggles preview. Capture phase so the shortcut wins
    // over vim/browser handling while a markdown buffer is open.
    const onPreviewKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== 'v') return;
      if (!isMarkdownPath(currentPath)) return;
      event.preventDefault();
      event.stopPropagation();
      document.dispatchEvent(new CustomEvent('we:preview-toggle'));
    };

    const onPreviewToggle = (event: Event) => {
      if (!isMarkdownPath(currentPath)) return;
      const detail = (event as CustomEvent<{ enabled?: boolean } | null>).detail;
      togglePreview(detail?.enabled);
      editor?.focus();
    };

    document.addEventListener('we:open', onOpen);
    document.addEventListener('we:theme', onTheme);
    document.addEventListener('we:preview-toggle', onPreviewToggle);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onPreviewKey, true);
    window.addEventListener('beforeunload', flushDirty);

    onCleanup(() => {
      document.removeEventListener('we:open', onOpen);
      document.removeEventListener('we:theme', onTheme);
      document.removeEventListener('we:preview-toggle', onPreviewToggle);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onPreviewKey, true);
      window.removeEventListener('beforeunload', flushDirty);
      window.clearTimeout(dirtyTimer);
      window.clearTimeout(messageTimer);
      sync?.destroy();
      preview?.destroy();
      split?.destroy();
      editor?.destroy();
    });
  });

  return (
    <div class="we-split" ref={splitHost}>
      <div class="we-editor-pane">
        <div class="cm-host" ref={host} />
        <button
          type="button"
          class="we-preview-toggle"
          ref={toggleBtn}
          hidden
          aria-pressed="false"
          title="Show Markdown preview (Ctrl+Shift+V)"
          onClick={() => {
            document.dispatchEvent(new CustomEvent('we:preview-toggle'));
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8 12.1 12.2 8 12.2 1.5 8 1.5 8Z"
              stroke="currentColor"
              stroke-width="1.3"
            />
            <circle cx="8" cy="8" r="1.7" stroke="currentColor" stroke-width="1.3" />
          </svg>
          <span>Preview</span>
        </button>
      </div>
      <div
        class="we-split-divider"
        ref={divider}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Markdown preview"
        tabindex="0"
      />
      <div class="we-preview-pane" ref={previewHost} />
    </div>
  );
}
