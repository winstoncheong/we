import { useEffect, useRef, type KeyboardEvent } from 'react';

export type PaletteItem = {
  key: string;
  label: string;
  dir?: string;
  hint?: string;
  run: () => void;
};

type Props = {
  mode: 'files' | 'commands';
  query: string;
  items: PaletteItem[];
  index: number;
  onQuery: (query: string) => void;
  onIndex: (index: number) => void;
  onPick: (item: PaletteItem) => void;
  onClose: () => void;
};

export default function CommandPalette({
  mode,
  query,
  items,
  index,
  onQuery,
  onIndex,
  onPick,
  onClose,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const row = listRef.current?.children[index] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const move = (delta: number) => {
    if (items.length === 0) return;
    onIndex((index + delta + items.length) % items.length);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'PageDown':
        e.preventDefault();
        onIndex(Math.min(items.length - 1, index + 8));
        break;
      case 'PageUp':
        e.preventDefault();
        onIndex(Math.max(0, index - 8));
        break;
      case 'Home':
        e.preventDefault();
        onIndex(0);
        break;
      case 'End':
        e.preventDefault();
        onIndex(Math.max(0, items.length - 1));
        break;
      case 'Enter': {
        e.preventDefault();
        const item = items[index];
        if (item) onPick(item);
        break;
      }
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-head">
          <span className="palette-prefix">{mode === 'files' ? '>' : '$'}</span>
          <input
            autoFocus
            spellCheck={false}
            placeholder={mode === 'files' ? 'open file…' : 'run command…'}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="palette-mode">{mode === 'files' ? 'quick open' : 'commands'}</span>
        </div>

        {items.length === 0 ? (
          <div className="palette-empty">no matches for “{query}”</div>
        ) : (
          <ul className="palette-list" ref={listRef}>
            {items.map((item, i) => (
              <li key={item.key}>
                <button
                  className={i === index ? 'palette-row active' : 'palette-row'}
                  onClick={() => onPick(item)}
                  onMouseMove={() => i !== index && onIndex(i)}
                >
                  <span className="marker">›</span>
                  <span className="label">{item.label}</span>
                  {item.dir && <span className="dir">{item.dir}</span>}
                  {item.hint && <span className="hint">{item.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="palette-foot">
          <span>
            <b>↑↓</b> move
          </span>
          <span>
            <b>↵</b> open
          </span>
          <span>
            <b>esc</b> dismiss
          </span>
          <span className="status-spacer" />
          <span>
            {items.length} {items.length === 1 ? 'result' : 'results'}
          </span>
        </div>
      </div>
    </div>
  );
}
