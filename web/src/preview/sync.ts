// Two-way scroll sync, following VS Code's model: the pane the user last
// touched drives, the other one follows. Preview → editor binary-searches the
// rendered blocks and interpolates between their source line numbers; editor →
// preview uses CodeMirror's line blocks (never a per-line loop). Writes to the
// passive pane are flagged so their scroll events do not bounce back.

import type { EditorView } from '@codemirror/view';

export type Pane = 'editor' | 'preview';

export type ScrollSync = {
  setEnabled: (on: boolean) => void;
  syncFrom: (pane: Pane) => void;
  destroy: () => void;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

export function createScrollSync(options: {
  view: () => EditorView | undefined;
  preview: () => HTMLElement | null;
}): ScrollSync {
  let enabled = false;
  let active: Pane = 'editor';
  let frame = 0;
  const suppress = { editor: false, preview: false };
  const cleanups: Array<() => void> = [];

  const blocks = (preview: HTMLElement) =>
    Array.from(preview.querySelectorAll<HTMLElement>('.md-block[data-line]'));

  const previewTop = (preview: HTMLElement, el: HTMLElement, rect: DOMRect) =>
    el.getBoundingClientRect().top - rect.top + preview.scrollTop;

  const scrollEditorToLine = (view: EditorView, lineFloat: number) => {
    const doc = view.state.doc;
    const lineNumber = clamp(Math.round(lineFloat), 1, doc.lines);
    const block = view.lineBlockAt(doc.line(lineNumber).from);
    const lineHeight = view.defaultLineHeight || 21;
    const fraction = clamp(lineFloat - Math.floor(lineFloat), 0, 1);
    const target =
      block.top + view.documentPadding.top + fraction * Math.min(block.height, lineHeight);
    const scroller = view.scrollDOM;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const next = clamp(target, 0, max);
    if (near(scroller.scrollTop, next)) return;
    suppress.editor = true;
    scroller.scrollTop = next;
    requestAnimationFrame(() => {
      suppress.editor = false;
    });
  };

  const previewYForLine = (preview: HTMLElement, lineFloat: number): number => {
    const list = blocks(preview);
    if (!list.length) return 0;
    const rect = preview.getBoundingClientRect();
    const target = clamp(
      lineFloat,
      Number(list[0].dataset.line ?? 0),
      Number(list[list.length - 1].dataset.endLine ?? Infinity),
    );

    // Blocks are in document order and their `data-line` is monotonic.
    let lo = 0;
    let hi = list.length - 1;
    let index = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (Number(list[mid].dataset.line ?? 0) <= target) {
        index = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const start = list[index];
    const startLine = Number(start.dataset.line ?? 0);
    const startTop = previewTop(preview, start, rect);
    const next = list[index + 1];
    if (!next) {
      const endLine = Number(start.dataset.endLine ?? startLine + 1);
      const height = Math.max(1, start.getBoundingClientRect().height);
      const fraction = clamp((target - startLine) / Math.max(1, endLine - startLine), 0, 1);
      return startTop + fraction * height;
    }
    const nextLine = Number(next.dataset.line ?? startLine + 1);
    const nextTop = previewTop(preview, next, rect);
    const fraction = clamp((target - startLine) / Math.max(1, nextLine - startLine), 0, 1);
    return startTop + fraction * (nextTop - startTop);
  };

  const drivePreview = () => {
    const view = options.view();
    const preview = options.preview();
    if (!view || !preview) return;
    if (!blocks(preview).length) return;

    const scroller = view.scrollDOM;
    const rect = scroller.getBoundingClientRect();
    const top = rect.top - view.documentTop;
    const block = view.lineBlockAtHeight(top);
    const line = view.state.doc.lineAt(block.from).number;
    const lineHeight = view.defaultLineHeight || 21;
    const lines = Math.max(1, Math.round(block.height / lineHeight));
    const within = block.height > 0 ? clamp((top - block.top) / block.height, 0, 1) : 0;
    // Preview `data-line` is 0-based; CodeMirror lines are 1-based.
    const lineFloat = line - 1 + within * lines;

    const y = previewYForLine(preview, lineFloat);
    const max = Math.max(0, preview.scrollHeight - preview.clientHeight);
    const next = clamp(y, 0, max);
    if (near(preview.scrollTop, next)) return;
    suppress.preview = true;
    preview.scrollTop = next;
    requestAnimationFrame(() => {
      suppress.preview = false;
    });
  };

  const driveEditor = () => {
    const view = options.view();
    const preview = options.preview();
    if (!view || !preview) return;
    const list = blocks(preview);
    if (!list.length) return;

    const rect = preview.getBoundingClientRect();
    const y = preview.scrollTop;
    let lo = 0;
    let hi = list.length - 1;
    let index = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (previewTop(preview, list[mid], rect) <= y + 0.5) {
        index = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (index < 0) index = 0;

    const start = list[index];
    const startLine = Number(start.dataset.line ?? 0);
    const startTop = previewTop(preview, start, rect);
    let lineFloat = startLine;
    const next = list[index + 1];
    if (next) {
      const nextLine = Number(next.dataset.line ?? startLine + 1);
      const nextTop = previewTop(preview, next, rect);
      const fraction =
        nextTop > startTop ? clamp((y - startTop) / (nextTop - startTop), 0, 1) : 0;
      lineFloat = startLine + fraction * Math.max(1, nextLine - startLine);
    } else {
      const endLine = Number(start.dataset.endLine ?? startLine + 1);
      const height = Math.max(1, start.getBoundingClientRect().height);
      const fraction = clamp((y - startTop) / height, 0, 1);
      lineFloat = startLine + fraction * Math.max(1, endLine - startLine);
    }
    scrollEditorToLine(view, lineFloat);
  };

  const schedule = (pane: Pane) => {
    if (!enabled) return;
    if (suppress[pane]) {
      suppress[pane] = false;
      return;
    }
    if (active !== pane || frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!enabled || active !== pane) return;
      if (pane === 'editor') drivePreview();
      else driveEditor();
    });
  };

  const bind = (
    element: HTMLElement,
    pane: Pane,
    onScroll: () => void,
  ) => {
    const wake = () => {
      active = pane;
    };
    const listeners: Array<[keyof HTMLElementEventMap, EventListener]> = [
      ['pointerenter', wake],
      ['pointerdown', wake],
      ['wheel', wake],
      ['touchstart', wake],
      ['keydown', wake],
      ['focusin', wake],
      ['scroll', onScroll],
    ];
    for (const [name, handler] of listeners) {
      const opts: AddEventListenerOptions | undefined =
        name === 'wheel' || name === 'touchstart' ? { passive: true } : undefined;
      element.addEventListener(name, handler, opts);
      cleanups.push(() => element.removeEventListener(name, handler, opts));
    }
  };

  const view = options.view();
  if (view) bind(view.scrollDOM, 'editor', () => schedule('editor'));
  const preview = options.preview();
  if (preview) bind(preview, 'preview', () => schedule('preview'));

  return {
    setEnabled: (on) => {
      enabled = on;
      if (!on) {
        if (frame !== 0) cancelAnimationFrame(frame);
        frame = 0;
        suppress.editor = false;
        suppress.preview = false;
        active = 'editor';
      }
    },
    syncFrom: (pane) => {
      if (!enabled) return;
      active = pane;
      if (pane === 'editor') drivePreview();
      else driveEditor();
    },
    destroy: () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
    },
  };
}
