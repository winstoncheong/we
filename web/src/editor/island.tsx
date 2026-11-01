import { onCleanup, onMount } from 'solid-js';

import { createEditor, type Editor } from './createEditor';
import { getTheme } from '../theme/pierre';
import { currentTheme, token } from '../theme';

const VIM_KEY = 'we:vim';

function vimEnabled(): boolean {
  try {
    return localStorage.getItem(VIM_KEY) !== 'false';
  } catch {
    return true;
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
  let editor: Editor | undefined;
  let dirtyTimer: number | undefined;
  let messageTimer: number | undefined;
  let dirty = false;
  let currentPath = '';

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

  const load = async (path: string) => {
    if (!editor) return;
    if (!path) {
      currentPath = '';
      document.getElementById('editor')?.removeAttribute('data-path');
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
  };

  onMount(() => {
    editor = createEditor(
      host,
      {
        path: '',
        doc: '',
        theme: appTheme(),
        vim: vimEnabled(),
        onChange: () => markDirty(),
        onStats: (stats) => {
          setStatus('cursor', `ln ${stats.line}, col ${stats.col}`);
          setStatus('mode', stats.mode);
        },
      },
    );

    const initial = document.getElementById('editor')?.dataset.path ?? '';
    if (initial) void load(initial);

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

    document.addEventListener('we:open', onOpen);
    document.addEventListener('we:theme', onTheme);
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', flushDirty);

    onCleanup(() => {
      document.removeEventListener('we:open', onOpen);
      document.removeEventListener('we:theme', onTheme);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', flushDirty);
      window.clearTimeout(dirtyTimer);
      window.clearTimeout(messageTimer);
      editor?.destroy();
    });
  });

  return <div class="cm-host" ref={host} />;
}
