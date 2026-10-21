import { useCallback, useEffect, useMemo, useState } from 'react';
import CodeMirrorEditor from './editor/CodeMirrorEditor';
import { languageLabel } from './editor/languages';
import FileTreePane from './components/FileTreePane';
import { demoPaths, isTauri, listFilesRecursive, pickFolder, readFile, writeFile } from './fs';

type PaletteMode = 'files' | 'commands';

const COMMANDS = [
  { id: 'open-folder', label: 'Open Folder…' },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar' },
  { id: 'toggle-vim', label: 'Toggle Vim Mode' },
  { id: 'save-all', label: 'Save All' },
  { id: 'close-tab', label: 'Close Active Tab' },
] as const;

export default function App() {
  const [root, setRoot] = useState<string | null>(null);
  const [paths, setPaths] = useState<string[]>(() => demoPaths());
  const [tabs, setTabs] = useState<string[]>(() => ['welcome.md']);
  const [active, setActive] = useState<string>('welcome.md');
  const [contents, setContents] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [sidebar, setSidebar] = useState(true);
  const [vim, setVim] = useState(true);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  const loadFile = useCallback(
    async (p: string) => {
      if (contents[p] !== undefined) return;
      try {
        const text = await readFile(root, p);
        setContents((m) => ({ ...m, [p]: text }));
      } catch {
        setStatus(`cannot open ${p}`);
      }
    },
    [contents, root],
  );

  const openPath = useCallback(
    (p: string) => {
      setTabs((t) => (t.includes(p) ? t : [...t, p]));
      setActive(p);
      void loadFile(p);
    },
    [loadFile],
  );

  const saveActive = useCallback(async () => {
    const text = contents[active] ?? '';
    try {
      await writeFile(root, active, text);
      setDirty((d) => {
        const n = new Set(d);
        n.delete(active);
        return n;
      });
      setStatus(`saved ${active}`);
    } catch {
      setStatus(`save failed: ${active}`);
    }
  }, [active, contents, root]);

  const openFolder = useCallback(async () => {
    if (!isTauri()) {
      setStatus('browser mode: Tauri folder picker needs `npm run tauri dev`');
      return;
    }
    const dir = await pickFolder();
    if (!dir) return;
    setRoot(dir);
    try {
      const files = await listFilesRecursive(dir);
      setPaths(files);
      setContents({});
      setDirty(new Set());
      setTabs([]);
      setActive('');
      setStatus(`${files.length} files — ${dir}`);
      if (files[0]) openPath(files[0]);
    } catch {
      setStatus('failed to read folder');
    }
  }, [openPath]);

  const runCommand = useCallback(
    async (id: string) => {
      setPalette(null);
      setQuery('');
      if (id === 'open-folder') void openFolder();
      else if (id === 'toggle-sidebar') setSidebar((s) => !s);
      else if (id === 'toggle-vim') setVim((v) => !v);
      else if (id === 'close-tab')
        setTabs((t) => {
          const n = t.filter((x) => x !== active);
          if (n.length > 0) setActive(n[n.length - 1]);
          return n;
        });
      else if (id === 'save-all') {
        for (const p of dirty) {
          try {
            await writeFile(root, p, contents[p] ?? '');
          } catch {
            setStatus(`save failed: ${p}`);
            return;
          }
        }
        setDirty(new Set());
        setStatus('saved all');
      }
    },
    [active, contents, dirty, openFolder, root],
  );

  // Sublime-ish global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'p' && !e.shiftKey) {
        e.preventDefault();
        setPalette('files');
        setQuery('');
      } else if (mod && e.key.toLowerCase() === 'p' && e.shiftKey) {
        e.preventDefault();
        setPalette('commands');
        setQuery('');
      } else if (mod && e.key.toLowerCase() === 'b' && (e as KeyboardEvent & { code?: string }).code !== undefined) {
        // Ctrl+K Ctrl+B chord is handled below; plain Ctrl+B also toggles.
        e.preventDefault();
        setSidebar((s) => !s);
      } else if (mod && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        setTabs((t) => {
          const n = t.filter((x) => x !== active);
          if (n.length > 0) setActive(n[n.length - 1]);
          return n;
        });
      } else if (e.key === 'Escape') {
        setPalette(null);
      }
    };
    // Sublime chord: Ctrl+K, Ctrl+B
    let kArmed = false;
    let kTimer: number | undefined;
    const onChord = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        kArmed = true;
        window.clearTimeout(kTimer);
        kTimer = window.setTimeout(() => (kArmed = false), 800);
      } else if (kArmed && mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebar((s) => !s);
        kArmed = false;
      }
    };
    const handler = (e: KeyboardEvent) => {
      onChord(e);
      onKey(e);
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.clearTimeout(kTimer);
    };
  }, [active]);

  // Load initial tab.
  useEffect(() => {
    if (active && contents[active] === undefined) void loadFile(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (palette === 'files') {
      return paths.filter((p) => p.toLowerCase().includes(q)).slice(0, 50);
    }
    return COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
  }, [palette, paths, query]);

  return (
    <div className="app">
      <header className="topbar">
        <button onClick={openFolder} title="Open folder">
          {root ? root.split(/[\\/]/).pop() : 'Open folder'}
        </button>
        <span className="hint">Ctrl+P files · Ctrl+Shift+P commands · Ctrl+S save · Ctrl+K Ctrl+B sidebar</span>
        <label className="vim-toggle">
          <input type="checkbox" checked={vim} onChange={(e) => setVim(e.target.checked)} />
          Vim
        </label>
      </header>

      <div className="main">
        {sidebar && (
          <aside className="sidebar">
            <FileTreePane paths={paths} onOpen={openPath} />
          </aside>
        )}
        <section className="editor-col">
          <div className="tabs">
            {tabs.map((t) => (
              <button
                key={t}
                className={t === active ? 'tab active' : 'tab'}
                onClick={() => setActive(t)}
              >
                {t.split('/').pop()}
                {dirty.has(t) ? ' •' : ''}
              </button>
            ))}
          </div>
          <div className="editor">
            {active ? (
              <CodeMirrorEditor
                path={active}
                value={contents[active] ?? ''}
                vimEnabled={vim}
                onChange={(v) => {
                  setContents((m) => ({ ...m, [active]: v }));
                  setDirty((d) => new Set(d).add(active));
                }}
                onSave={saveActive}
              />
            ) : (
              <div className="empty">Ctrl+O or Open folder to start</div>
            )}
          </div>
        </section>
      </div>

      <footer className="statusbar">
        <span>{active || '—'}</span>
        <span>{active ? languageLabel(active) : ''}</span>
        <span>{vim ? '-- NORMAL-ish (F1 for vim help in editor) --' : 'vim off'}</span>
        <span>{dirty.size > 0 ? `${dirty.size} unsaved` : status || (isTauri() ? 'tauri' : 'browser demo')}</span>
      </footer>

      {palette && (
        <div className="palette-backdrop" onClick={() => setPalette(null)}>
          <div className="palette" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              placeholder={palette === 'files' ? 'Type a file name…' : 'Type a command…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered.length > 0) {
                  const item = filtered[0] as string | { id: string };
                  if (typeof item === 'string') {
                    openPath(item);
                    setPalette(null);
                    setQuery('');
                  } else {
                    void runCommand(item.id);
                  }
                }
              }}
            />
            <ul>
              {filtered.map((item) => {
                const key = typeof item === 'string' ? item : item.id;
                const label = typeof item === 'string' ? item : item.label;
                return (
                  <li key={key}>
                    <button
                      onClick={() => {
                        if (typeof item === 'string') {
                          openPath(item);
                          setPalette(null);
                          setQuery('');
                        } else void runCommand(item.id);
                      }}
                    >
                      {label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
