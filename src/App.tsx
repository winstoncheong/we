import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirrorEditor, { type EditorStats } from './editor/CodeMirrorEditor';
import { languageLabel } from './editor/languages';
import FileTreePane from './components/FileTreePane';
import TabStrip from './components/TabStrip';
import StatusBar from './components/StatusBar';
import TitleBar from './components/TitleBar';
import EmptyState from './components/EmptyState';
import CommandPalette, { type PaletteItem } from './components/CommandPalette';
import { backendLabel, demoPaths, isTauri, listFilesRecursive, pickFolder, readFile, supportsBrowserFS, writeFile } from './fs';
import { getTheme, otherTheme, THEME_ORDER, type ThemeName } from './theme/pierre';

type PaletteMode = 'files' | 'commands';

const THEME_KEY = 'we:theme';

const IDLE_STATS: EditorStats = { line: 1, col: 1, lines: 1, mode: 'NORMAL' };

function initialTheme(): ThemeName {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(THEME_KEY);
  return THEME_ORDER.includes(stored as ThemeName) ? (stored as ThemeName) : 'pierre-dark';
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function dirname(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut > 0 ? `${path.slice(0, cut)}/` : '';
}

function matches(query: string, haystack: string): boolean {
  const q = query.toLowerCase();
  const h = haystack.toLowerCase();
  if (q.length === 0 || h.includes(q)) return true;
  // Fall back to subsequence matching, the way fuzzy finders do.
  let i = 0;
  for (const char of h) {
    if (char === q[i]) i += 1;
    if (i === q.length) return true;
  }
  return false;
}

export default function App() {
  const [root, setRoot] = useState<string | null>(null);
  const [paths, setPaths] = useState<string[]>(() => demoPaths());
  const [tabs, setTabs] = useState<string[]>(() => ['welcome.md']);
  const [active, setActive] = useState<string>('welcome.md');
  const [contents, setContents] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [sidebar, setSidebar] = useState(true);
  const [vim, setVim] = useState(true);
  const [themeName, setThemeName] = useState<ThemeName>(initialTheme);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [query, setQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [status, setStatus] = useState('');
  const [stats, setStats] = useState<EditorStats>(IDLE_STATS);

  const theme = getTheme(themeName);
  const contentsRef = useRef(contents);
  contentsRef.current = contents;

  // Paint the shell from the resolved Pierre theme.
  useEffect(() => {
    const style = document.documentElement.style;
    for (const [prop, value] of Object.entries(theme.vars)) style.setProperty(prop, value);
    document.documentElement.style.colorScheme = theme.scheme;
    document.documentElement.dataset.theme = theme.name;
    localStorage.setItem(THEME_KEY, theme.name);
  }, [theme]);

  const loadFile = useCallback(
    async (p: string) => {
      if (contentsRef.current[p] !== undefined) return;
      try {
        const text = await readFile(root, p);
        setContents((m) => ({ ...m, [p]: text }));
      } catch {
        setStatus(`cannot open ${p}`);
      }
    },
    [root],
  );

  const openPath = useCallback(
    (p: string) => {
      setTabs((t) => (t.includes(p) ? t : [...t, p]));
      setActive(p);
      void loadFile(p);
    },
    [loadFile],
  );

  const closeTab = useCallback((path: string) => {
    setTabs((t) => {
      const index = t.indexOf(path);
      const next = t.filter((x) => x !== path);
      if (path === active) {
        const neighbour = next[Math.min(index, next.length - 1)];
        setActive(neighbour ?? '');
      }
      return next;
    });
  }, [active]);

  const saveActive = useCallback(async () => {
    if (!active) return;
    try {
      await writeFile(root, active, contents[active] ?? '');
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
    if (!isTauri() && !supportsBrowserFS()) {
      setStatus('browser lacks File System Access API — use Chrome/Edge or `npm run tauri dev`');
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

  const toggleTheme = useCallback(() => {
    setThemeName((name) => otherTheme(name));
  }, []);

  // Status messages are transient; the footer goes back to the workspace label.
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(''), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const toggleSidebar = useCallback(() => setSidebar((s) => !s), []);

  const commands = useMemo<PaletteItem[]>(
    () => [
      { key: 'open-folder', label: 'Open folder…', hint: 'ctrl o', run: () => void openFolder() },
      { key: 'files', label: 'Quick open file…', hint: 'ctrl p', run: () => setPalette('files') },
      { key: 'save', label: 'Save', hint: 'ctrl s', run: () => void saveActive() },
      {
        key: 'save-all',
        label: 'Save all',
        hint: `${dirty.size} unsaved`,
        run: () => {
          void (async () => {
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
          })();
        },
      },
      {
        key: 'close-tab',
        label: 'Close active tab',
        hint: 'ctrl w',
        run: () => active && closeTab(active),
      },
      { key: 'toggle-sidebar', label: 'Toggle sidebar', hint: 'ctrl k ctrl b', run: toggleSidebar },
      {
        key: 'toggle-vim',
        label: vim ? 'Disable vim mode' : 'Enable vim mode',
        hint: vim ? 'on' : 'off',
        run: () => setVim((v) => !v),
      },
      {
        key: 'toggle-theme',
        label: `Switch theme → ${otherTheme(themeName)}`,
        hint: 'ctrl k ctrl t',
        run: toggleTheme,
      },
    ],
    [
      active,
      closeTab,
      contents,
      dirty,
      openFolder,
      root,
      saveActive,
      themeName,
      toggleSidebar,
      toggleTheme,
      vim,
    ],
  );

  const items = useMemo<PaletteItem[]>(() => {
    if (palette === 'files') {
      return paths
        .filter((p) => matches(query, p))
        .slice(0, 200)
        .map((p) => ({
          key: p,
          label: basename(p),
          dir: dirname(p),
          hint: dirty.has(p) ? 'unsaved' : undefined,
          run: () => openPath(p),
        }));
    }
    return commands.filter((c) => matches(query, c.label));
  }, [commands, dirty, openPath, palette, paths, query]);

  useEffect(() => {
    setPaletteIndex(0);
  }, [query, palette]);

  const runPaletteItem = useCallback((item: PaletteItem) => {
    if (item.key === 'files') {
      // Swap the palette into file mode instead of dismissing it.
      item.run();
      setQuery('');
      return;
    }
    setPalette(null);
    setQuery('');
    item.run();
  }, []);

  // Region shortcuts: Sublime-style chords plus the usual suspects.
  useEffect(() => {
    let chordTimer: number | undefined;
    let chord: 'k' | null = null;

    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'k') {
        chord = 'k';
        window.clearTimeout(chordTimer);
        chordTimer = window.setTimeout(() => (chord = null), 900);
        return;
      }

      if (mod && chord === 'k') {
        chord = null;
        if (key === 'b') {
          e.preventDefault();
          toggleSidebar();
          return;
        }
        if (key === 't') {
          e.preventDefault();
          toggleTheme();
          return;
        }
      }

      if (mod && key === 'p') {
        e.preventDefault();
        setPalette(e.shiftKey ? 'commands' : 'files');
        setQuery('');
      } else if (mod && key === 's') {
        e.preventDefault();
        void saveActive();
      } else if (mod && key === 'o') {
        e.preventDefault();
        void openFolder();
      } else if (mod && key === 'w') {
        e.preventDefault();
        if (active) closeTab(active);
      } else if (mod && key === 'b') {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === 'Escape') {
        setPalette(null);
        setQuery('');
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(chordTimer);
    };
  }, [active, closeTab, openFolder, saveActive, toggleSidebar, toggleTheme]);

  // Open the initial buffer once.
  useEffect(() => {
    if (active && contents[active] === undefined) void loadFile(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className="app">
      <TitleBar
        root={root}
        theme={theme}
        vim={vim}
        sidebar={sidebar}
        onOpenFolder={openFolder}
        onOpenFiles={() => {
          setPalette('files');
          setQuery('');
        }}
        onOpenCommands={() => {
          setPalette('commands');
          setQuery('');
        }}
        onToggleSidebar={toggleSidebar}
        onToggleVim={() => setVim((v) => !v)}
        onToggleTheme={toggleTheme}
      />

      <div className="workspace">
        <aside className={sidebar ? 'sidebar' : 'sidebar hidden'}>
          <div className="panel-head">
            <span>
              <span className="hash">#</span> files
            </span>
            <span className="panel-head-right">
              <span className="panel-count">{String(paths.length).padStart(2, '0')}</span>
              <button
                className="panel-btn"
                onClick={toggleSidebar}
                title="Hide sidebar (ctrl+b)"
                aria-label="Hide sidebar"
              >
                «
              </button>
            </span>
          </div>

          <FileTreePane paths={paths} active={active} dirty={dirty} theme={theme} onOpen={openPath} />

          <div className="panel-foot">
            <span>{status || (root ? 'local folder' : 'demo workspace')}</span>
          </div>
        </aside>

        <section className="editor-col">
          <TabStrip tabs={tabs} active={active} dirty={dirty} onSelect={setActive} onClose={closeTab} />
          <div className="editor">
            {active ? (
              <CodeMirrorEditor
                path={active}
                value={contents[active] ?? ''}
                theme={theme}
                vimEnabled={vim}
                onStats={setStats}
                onChange={(v) => {
                  setContents((m) => ({ ...m, [active]: v }));
                  setDirty((d) => new Set(d).add(active));
                }}
                onSave={saveActive}
              />
            ) : (
              <EmptyState />
            )}
          </div>
        </section>
      </div>

      <StatusBar
        file={active}
        language={active ? languageLabel(active) : ''}
        stats={active ? stats : IDLE_STATS}
        dirtyCount={dirty.size}
        backend={backendLabel()}
        vim={vim}
        theme={theme}
      />

      {palette && (
        <CommandPalette
          mode={palette}
          query={query}
          items={items}
          index={Math.min(paletteIndex, Math.max(0, items.length - 1))}
          onQuery={setQuery}
          onIndex={setPaletteIndex}
          onPick={runPaletteItem}
          onClose={() => {
            setPalette(null);
            setQuery('');
          }}
        />
      )}
    </div>
  );
}
