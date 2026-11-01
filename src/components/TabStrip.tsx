type Props = {
  tabs: string[];
  active: string;
  dirty: Set<string>;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
};

export default function TabStrip({ tabs, active, dirty, onSelect, onClose }: Props) {
  return (
    <div className="tabs" role="tablist" aria-label="Open files">
      {tabs.length === 0 && <span className="tabs-empty">no open buffers</span>}
      {tabs.map((path) => {
        const cut = path.lastIndexOf('/');
        const dir = cut >= 0 ? path.slice(0, cut + 1) : '';
        const name = path.slice(cut + 1);
        const isActive = path === active;
        return (
          <div
            key={path}
            className={isActive ? 'tab active' : 'tab'}
            role="tab"
            aria-selected={isActive}
            onAuxClick={(e) => {
              if (e.button === 1) onClose(path);
            }}
          >
            <button className="tab-main" onClick={() => onSelect(path)} title={path}>
              {dir && <span className="tab-dir">{dir}</span>}
              <span className="tab-name">{name}</span>
            </button>
            {dirty.has(path) && (
              <span className="tab-dirty" aria-label="unsaved">
                ●
              </span>
            )}
            <button
              className="tab-close"
              onClick={() => onClose(path)}
              aria-label={`Close ${name}`}
              title="Close (ctrl+w)"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
