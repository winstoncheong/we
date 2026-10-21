import { useEffect } from 'react';
import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react';

type Props = {
  paths: string[];
  onOpen: (path: string) => void;
};

export default function FileTreePane({ paths, onOpen }: Props) {
  const { model } = useFileTree({
    initialExpansion: 'open',
    paths: paths.length > 0 ? paths : ['welcome.md'],
    search: true,
  });
  const selection = useFileTreeSelection(model);

  // Keep model in sync when folder contents change (hook creates model once).
  useEffect(() => {
    if (paths.length > 0) {
      model.resetPaths(paths);
    }
  }, [model, paths]);

  useEffect(() => {
    const first = selection[0];
    if (first) onOpen(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  return (
    <div className="tree-wrap">
      <FileTree model={model} style={{ height: '100%' }} />
    </div>
  );
}
