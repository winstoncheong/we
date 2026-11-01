// Split layout: editor | draggable divider | preview. Only CSS classes and one
// custom property change when the preview is toggled, so the editor gets no
// extra chrome for non-markdown files. The ratio (20%..80%) is reported once
// per drag so the island can persist it.

const MIN = 0.2;
const MAX = 0.8;
const DIVIDER = 6;

export type SplitLayout = {
  setEnabled: (on: boolean) => void;
  setRatio: (ratio: number) => void;
  ratio: () => number;
  destroy: () => void;
};

const clamp = (value: number) => Math.min(MAX, Math.max(MIN, value));

export function createSplitLayout(options: {
  root: HTMLElement;
  divider: HTMLElement;
  initialRatio: number;
  onRatioChange?: (ratio: number) => void;
}): SplitLayout {
  const { root, divider, onRatioChange } = options;
  let ratio = clamp(Number.isFinite(options.initialRatio) ? options.initialRatio : 0.5);
  let dragging = false;
  let pointer: number | undefined;

  const apply = () => {
    root.style.setProperty('--we-split-ratio', String(ratio));
  };

  const setRatio = (next: number, persist: boolean) => {
    ratio = clamp(next);
    apply();
    if (persist) onRatioChange?.(ratio);
  };

  const ratioFromEvent = (event: PointerEvent) => {
    const rect = root.getBoundingClientRect();
    const usable = Math.max(1, rect.width - DIVIDER);
    return (event.clientX - rect.left) / usable;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    event.preventDefault();
    setRatio(ratioFromEvent(event), false);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('is-resizing');
    if (pointer !== undefined && divider.hasPointerCapture(pointer)) {
      divider.releasePointerCapture(pointer);
    }
    pointer = undefined;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    setRatio(ratioFromEvent(event), true);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    pointer = event.pointerId;
    root.classList.add('is-resizing');
    divider.setPointerCapture(event.pointerId);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    if (event.key === 'ArrowLeft') setRatio(ratio - step, true);
    else if (event.key === 'ArrowRight') setRatio(ratio + step, true);
    else if (event.key === 'Home') setRatio(0.5, true);
    else return;
    event.preventDefault();
  };

  const onDoubleClick = () => setRatio(0.5, true);

  apply();
  divider.addEventListener('pointerdown', onPointerDown);
  divider.addEventListener('keydown', onKeyDown);
  divider.addEventListener('dblclick', onDoubleClick);

  return {
    setEnabled: (on) => {
      root.classList.toggle('is-split', on);
    },
    setRatio: (next) => setRatio(next, false),
    ratio: () => ratio,
    destroy: () => {
      divider.removeEventListener('pointerdown', onPointerDown);
      divider.removeEventListener('keydown', onKeyDown);
      divider.removeEventListener('dblclick', onDoubleClick);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    },
  };
}
