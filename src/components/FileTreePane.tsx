import { useEffect, useRef } from 'react';
import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react';
import type { AppTheme } from '../theme/pierre';

type Props = {
  paths: string[];
  active: string;
  dirty: Set<string>;
  theme: AppTheme;
  onOpen: (path: string) => void;
};

const SEP = '\u0000';

export default function FileTreePane({ paths, active, dirty, theme, onOpen }: Props) {
  const { model } = useFileTree({
    initialExpansion: 'open',
    flattenEmptyDirectories: true,
    paths: paths.length > 0 ? paths : ['README.md'],
    search: true,
    density: 'compact',
    icons: { set: 'minimal', colored: false },
    // The tree lives in a shadow root; every font there is inherited or set here.
    unsafeCSS: `
      :host, button, input { font-family: var(--mono, ui-monospace, monospace); }
      input { font-size: 12px; }
    `,
  });
  const selection = useFileTreeSelection(model);

  // The selection array is rebuilt on every render, so key the effect by content.
  const selectionKey = selection.join(SEP);

  // Path we pushed into the tree ourselves. Selection events caused by that
  // push (including its intermediate states) must not echo back as navigation.
  const pushing = useRef<string | null>(null);

  // Keep the model in sync when a folder is opened or the demo set changes.
  useEffect(() => {
    if (paths.length > 0) model.resetPaths(paths);
  }, [model, paths]);

  // Tree selection -> active buffer. Ignore echoes of programmatic selection.
  useEffect(() => {
    const latest = selectionKey ? selectionKey.split(SEP).pop() : '';
    if (!latest) return;
    if (pushing.current) {
      if (latest === pushing.current) pushing.current = null;
      return;
    }
    onOpen(latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  // Unsaved buffers read as "modified", the way a git-aware tree would show it.
  useEffect(() => {
    model.setGitStatus(
      [...dirty].filter((path) => paths.includes(path)).map((path) => ({ path, status: 'modified' })),
    );
  }, [model, dirty, paths]);

  // Active buffer -> tree selection. `select()` is additive, so the rest of the
  // selection has to be cleared first.
  useEffect(() => {
    if (!active || !paths.includes(active)) return;
    const current = model.getSelectedPaths();
    if (current.length === 1 && current[0] === active) {
      pushing.current = null;
      return;
    }
    pushing.current = active;
    for (const path of current) {
      if (path !== active) model.getItem(path)?.deselect();
    }
    model.getItem(active)?.select();
    model.scrollToPath(active, { offset: 'nearest' });
  }, [model, active, paths]);

  // No buffer open: clear the selection so the same row can be clicked again.
  useEffect(() => {
    if (active) return;
    pushing.current = null;
    for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect();
  }, [model, active]);

  return (
    <div className="tree-wrap">
      <FileTree model={model} style={{ ...theme.treeStyles, height: '100%' }} />
    </div>
  );
}
