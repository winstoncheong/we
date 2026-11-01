import type { EditorStats } from '../editor/CodeMirrorEditor';
import type { AppTheme } from '../theme/pierre';

type Props = {
  file: string;
  language: string;
  stats: EditorStats;
  dirtyCount: number;
  backend: string;
  vim: boolean;
  theme: AppTheme;
};

export default function StatusBar({
  file,
  language,
  stats,
  dirtyCount,
  backend,
  vim,
  theme,
}: Props) {
  const mode = vim ? stats.mode : 'EDIT';
  const modeClass = mode.startsWith('INSERT')
    ? 'status-mode insert'
    : mode.startsWith('VISUAL')
      ? 'status-mode visual'
      : 'status-mode';

  const name = file ? file.split('/').pop() : '';
  const dir = file && file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';

  return (
    <footer className="statusbar">
      <span className="status-item plain">
        <span className={file ? 'status-accent' : 'status-dim'}>●</span>
        <span className="status-file">
          {dir && <span className="status-dim">{dir}</span>}
          {name || 'no buffer'}
        </span>
      </span>
      <span className="status-item">{language || '—'}</span>
      <span className="status-item">
        ln {stats.line}, col {stats.col}
        <span className="status-sep">/</span>
        {stats.lines}
      </span>
      <span className="status-item">
        <span className={modeClass}>-- {mode} --</span>
      </span>

      <span className="status-spacer" />

      {dirtyCount > 0 && (
        <span className="status-item plain">
          <span className="status-dirty">{dirtyCount} unsaved</span>
        </span>
      )}
      <span className="status-item plain">{backend}</span>
      <span className="status-item">{theme.name}</span>
      <span className="status-item">utf-8</span>
      <span className="status-item">lf</span>
    </footer>
  );
}
