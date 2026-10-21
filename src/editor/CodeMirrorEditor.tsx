import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import { vim } from '@replit/codemirror-vim';
import { languageForPath } from './languages';

type Props = {
  path: string;
  value: string;
  vimEnabled: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
};

export default function CodeMirrorEditor({ path, value, vimEnabled, onChange, onSave }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cbRef = useRef({ onChange, onSave });
  cbRef.current = { onChange, onSave };
  const pathRef = useRef(path);
  const valueRef = useRef(value);

  // Create once per path+vim setting.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';
    valueRef.current = value;

    const saveBinding = keymap.of([
      {
        key: 'Ctrl-s',
        run: () => {
          cbRef.current.onSave();
          return true;
        },
      },
    ]);

    const extensions = [
      saveBinding,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      history(),
      EditorView.lineWrapping,
      oneDark,
      languageForPath(path),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          const text = u.state.doc.toString();
          valueRef.current = text;
          cbRef.current.onChange(text);
        }
      }),
      ...(vimEnabled ? [vim()] : []),
    ];

    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    pathRef.current = path;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, vimEnabled]);

  // External updates (file switch already handled by path effect; this is for
  // reloads of the same path).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || pathRef.current !== path) return;
    if (value !== valueRef.current) {
      valueRef.current = value;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value, path]);

  // Ctrl+S from outside the vim insert-mode trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        cbRef.current.onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return <div ref={hostRef} className="cm-host" />;
}
