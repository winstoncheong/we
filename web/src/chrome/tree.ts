// Explorer expansion state survives fragment refreshes.
//
// The tree is server-rendered and a filesystem change replaces `#tree`'s whole
// innerHTML, which would reset every `<details>` to closed — a folder the user
// just opened would snap shut. Remember the open directories here and re-open
// them after each swap. Re-opening fires the same `toggle` trigger that lazily
// loads children, so nested folders come back one level at a time as their
// parents' children arrive.

const expanded = new Set<string>();

function tree(): HTMLElement | null {
  return document.getElementById('tree');
}

function isTreeSwap(event: Event): HTMLElement | null {
  const target = (event as CustomEvent<{ target?: Element }>).detail?.target;
  if (!(target instanceof HTMLElement)) return null;
  const root = tree();
  if (!root) return null;
  // The refresh lands on #tree itself; lazy child loads land inside it.
  return target === root || root.contains(target) ? target : null;
}

function remember(details: HTMLDetailsElement) {
  const path = details.dataset.path;
  if (!path) return;
  if (details.open) expanded.add(path);
  else expanded.delete(path);
}

function restore() {
  const root = tree();
  if (!root || expanded.size === 0) return;
  for (const details of root.querySelectorAll<HTMLDetailsElement>('details[data-path]')) {
    const path = details.dataset.path ?? '';
    if (!details.open && expanded.has(path)) details.open = true;
  }
}

export function setupTree() {
  const root = tree();
  if (!root) return;

  // `toggle` does not bubble, so it has to be captured on the way down.
  document.addEventListener(
    'toggle',
    (event) => {
      const details = event.target;
      if (details instanceof HTMLDetailsElement && root.contains(details)) remember(details);
    },
    true,
  );

  // Snapshot before the old DOM goes away, restore after the new one lands.
  document.addEventListener('htmx:beforeSwap', (event) => {
    if (!isTreeSwap(event)) return;
    for (const details of root.querySelectorAll<HTMLDetailsElement>('details[data-path][open]')) {
      remember(details);
    }
  });

  // Settle, not swap: htmx wires `hx-trigger` on the new nodes during settle,
  // and re-opening a `<details>` only reaches the server if that listener is
  // already attached.
  document.addEventListener('htmx:afterSettle', (event) => {
    if (!isTreeSwap(event)) return;
    restore();
  });
}
