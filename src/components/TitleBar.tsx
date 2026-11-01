import type { AppTheme } from '../theme/pierre';

type Props = {
  root: string | null;
  theme: AppTheme;
  vim: boolean;
  sidebar: boolean;
  onOpenFolder: () => void;
  onOpenFiles: () => void;
  onOpenCommands: () => void;
  onToggleSidebar: () => void;
  onToggleVim: () => void;
  onToggleTheme: () => void;
};

export default function TitleBar({
  root,
  theme,
  vim,
  sidebar,
  onOpenFolder,
  onOpenFiles,
  onOpenCommands,
  onToggleSidebar,
  onToggleVim,
  onToggleTheme,
}: Props) {
  const folder = root ? root.split(/[\\/]/).filter(Boolean).pop() : null;

  return (
    <header className="titlebar">
      <span className="brand">
        we<span className="brand-cursor">█</span>
      </span>
      <span className="titlebar-sep">│</span>

      <span className="root-path" title={root ?? 'demo workspace'}>
        <span className="tilde">~/</span>
        {folder ?? <span style={{ opacity: 0.7 }}>demo</span>}
      </span>

      <span className="titlebar-spacer" />

      <div className="titlebar-actions">
        {!sidebar && (
          <button className="chip" onClick={onToggleSidebar} title="Show sidebar (ctrl+b)">
            tree
          </button>
        )}
        <button className="chip" onClick={onOpenFolder} title="Open folder (ctrl+o)">
          folder <kbd>ctrl o</kbd>
        </button>
        <button className="chip" onClick={onOpenFiles} title="Quick open (ctrl+p)">
          open <kbd>ctrl p</kbd>
        </button>
        <button className="chip" onClick={onOpenCommands} title="Command palette (ctrl+shift+p)">
          run <kbd>ctrl ⇧ p</kbd>
        </button>
        <button
          className={vim ? 'chip on' : 'chip'}
          onClick={onToggleVim}
          title="Toggle vim keybindings"
        >
          vim
        </button>
        <button className="chip" onClick={onToggleTheme} title="Switch Pierre theme">
          {theme.scheme === 'dark' ? 'dark' : 'light'}
        </button>
      </div>
    </header>
  );
}
