import { Annotation, Compartment, EditorState } from '@codemirror/state';
import { EditorView, placeholder } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { vim } from '@replit/codemirror-vim';

import { languageForPath } from './languages';
import { editorTheme } from './theme';
import type { AppTheme } from '../theme/pierre';

/** Marks transactions we caused, so they never echo back as user edits. */
export const External = Annotation.define<boolean>();

export type CursorStats = {
  line: number;
  col: number;
  lines: number;
  mode: string;
};

const MODE_LABEL: Record<string, string> = {
  normal: 'normal',
  insert: 'insert',
  visual: 'visual',
  replace: 'replace',
};

type VimChange = { mode?: string; subMode?: string };
type VimCarrier = {
  cm?: {
    on(event: 'vim-mode-change', listener: (e: VimChange) => void): void;
    off?(event: 'vim-mode-change', listener: (e: VimChange) => void): void;
  };
};

type Options = {
  path: string;
  doc: string;
  theme: AppTheme;
  vim: boolean;
  onChange: (text: string) => void;
  onStats: (stats: CursorStats) => void;
};

export type Editor = {
  view: () => EditorView;
  path: () => string;
  text: () => string;
  /** Every open buffer with its current text, including the active one. */
  snapshot: () => Array<{ path: string; text: string }>;
  open: (path: string, doc: string) => void;
  setTheme: (theme: AppTheme) => void;
  setVim: (enabled: boolean) => void;
  focus: () => void;
  destroy: () => void;
};

/**
 * One EditorView, one EditorState per open buffer. Each buffer keeps its own
 * undo history, scroll offset and selection.
 */
export function createEditor(host: HTMLElement, options: Options): Editor {
  const themeCompartment = new Compartment();
  const vimCompartment = new Compartment();
  const states = new Map<string, EditorState>();

  let currentPath = options.path;
  let wantVim = options.vim;
  let wantTheme = options.theme;
  let mode = MODE_LABEL.normal;

  const makeState = (path: string, doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        placeholder('open a file — ctrl+p'),
        vimCompartment.of(wantVim ? vim() : []),
        themeCompartment.of(editorTheme(wantTheme)),
        languageForPath(path),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const external = update.transactions.some((tr) => tr.annotation(External));
            if (!external) options.onChange(update.state.doc.toString());
          }
          if (update.docChanged || update.selectionSet) report();
        }),
      ],
    });

  const view = new EditorView({
    parent: host,
    state: makeState(options.path, options.doc),
  });

  states.set(options.path, view.state);

  function report() {
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    options.onStats({
      line: line.number,
      col: head - line.from + 1,
      lines: view.state.doc.lines,
      mode,
    });
  }

  const carrier = view as unknown as VimCarrier;
  const onVimMode = (event: VimChange) => {
    const base = (event.mode ?? 'normal').toLowerCase();
    const suffix = event.subMode ? (event.subMode === 'linewise' ? ' line' : ' block') : '';
    mode = `${MODE_LABEL[base] ?? base}${suffix}`;
    report();
  };
  carrier.cm?.on('vim-mode-change', onVimMode);

  return {
    view: () => view,
    path: () => currentPath,
    text: () => view.state.doc.toString(),
    snapshot: () => {
      states.set(currentPath, view.state);
      return [...states.entries()].map(([path, state]) => ({
        path,
        text: state.doc.toString(),
      }));
    },
    open: (path, doc) => {
      states.set(currentPath, view.state);
      const next = states.get(path) ?? makeState(path, doc);
      states.set(path, next);
      currentPath = path;
      view.setState(next);
      // Compartments are not carried across setState, so re-apply our chrome.
      view.dispatch({
        effects: [themeCompartment.reconfigure(editorTheme(wantTheme)), vimCompartment.reconfigure(wantVim ? vim() : [])],
        selection: { anchor: 0 },
      });
      view.focus();
      report();
    },
    setTheme: (theme) => {
      wantTheme = theme;
      view.dispatch({ effects: themeCompartment.reconfigure(editorTheme(theme)) });
    },
    setVim: (enabled) => {
      wantVim = enabled;
      view.dispatch({ effects: vimCompartment.reconfigure(enabled ? vim() : []) });
    },
    focus: () => view.focus(),
    destroy: () => {
      carrier.cm?.off?.('vim-mode-change', onVimMode);
      view.destroy();
    },
  };
}
