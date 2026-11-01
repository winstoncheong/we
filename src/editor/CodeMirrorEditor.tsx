import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { vim } from '@replit/codemirror-vim';
import { languageForPath } from './languages';
import { editorTheme } from './theme';
import type { AppTheme } from '../theme/pierre';

export type EditorStats = {
  line: number;
  col: number;
  lines: number;
  mode: string;
};

type Props = {
  path: string;
  value: string;
  theme: AppTheme;
  vimEnabled: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onStats: (stats: EditorStats) => void;
};

type VimChange = { mode?: string; subMode?: string };
type VimCarrier = {
  cm?: {
    on(event: 'vim-mode-change', listener: (e: VimChange) => void): void;
    off?(event: 'vim-mode-change', listener: (e: VimChange) => void): void;
  };
};

const MODE_LABEL: Record<string, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
  replace: 'REPLACE',
};

export default function CodeMirrorEditor({
  path,
  value,
  theme,
  vimEnabled,
  onChange,
  onSave,
  onStats,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cbRef = useRef({ onChange, onSave, onStats });
  cbRef.current = { onChange, onSave, onStats };

  const themeCompartment = useRef(new Compartment());
  const vimCompartment = useRef(new Compartment());
  const pathRef = useRef(path);
  const valueRef = useRef(value);
  const applyingExternal = useRef(false);

  // Rebuild the document view when the file changes so each file keeps its own
  // undo history.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';
    valueRef.current = value;
    let currentMode = MODE_LABEL.normal;

    const stats = () => {
      const view = viewRef.current;
      if (!view) return;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      cbRef.current.onStats({
        line: line.number,
        col: head - line.from + 1,
        lines: view.state.doc.lines,
        mode: currentMode,
      });
    };

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        vimCompartment.current.of(vimEnabled ? vim() : []),
        themeCompartment.current.of(editorTheme(theme)),
        languageForPath(path),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const text = u.state.doc.toString();
            valueRef.current = text;
            if (!applyingExternal.current) cbRef.current.onChange(text);
          }
          if (u.docChanged || u.selectionSet) stats();
        }),
        EditorView.domEventHandlers({
          focus: () => {
            stats();
            return false;
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    pathRef.current = path;
    stats();

    // Surface vim's mode in our own status bar instead of a second one.
    const carrier = view as unknown as VimCarrier;
    const onVimMode = (e: VimChange) => {
      const base = (e.mode ?? 'normal').toLowerCase();
      const suffix = e.subMode ? (e.subMode === 'linewise' ? ' LINE' : ' BLOCK') : '';
      currentMode = `${MODE_LABEL[base] ?? base.toUpperCase()}${suffix}`;
      stats();
    };
    carrier.cm?.on('vim-mode-change', onVimMode);

    // Keep focus inside the editor unless the user is typing in chrome.
    view.focus();

    return () => {
      carrier.cm?.off?.('vim-mode-change', onVimMode);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Theme and vim mode swap in place; content, scroll and undo history survive.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(editorTheme(theme)),
    });
  }, [theme]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: vimCompartment.current.reconfigure(vimEnabled ? vim() : []),
    });
    viewRef.current?.focus();
  }, [vimEnabled]);

  // External updates (reload of the same path).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || pathRef.current !== path) return;
    if (value !== valueRef.current) {
      valueRef.current = value;
      applyingExternal.current = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
      applyingExternal.current = false;
    }
  }, [value, path]);

  return <div ref={hostRef} className="cm-host" />;
}
