// The preview pane owns one scroll container and patches the rendered
// document block by block. Markdown rendering is debounced (200ms trailing)
// and happens in a rAF, so keystrokes never wait for the parser; unchanged
// top-level blocks keep their DOM nodes (and their scroll positions).

import { createCodeHighlighter, type CodeHighlighter } from '../markdown/highlight';
import { createMarkdownRenderer, type PreviewBlock } from '../markdown/render';
import { currentTheme } from '../theme';
import { isMarkdownPath, isMdxPath } from './paths';

import './preview.css';

const DEBOUNCE_MS = 200;
const MAX_HIGHLIGHT_CHARS = 120_000;

type BlockNode = { html: string; el: HTMLElement };

export type PreviewPane = {
  setPath: (path: string) => void;
  setEnabled: (enabled: boolean) => void;
  /** Render immediately (file open / toggle on). */
  update: (source: string) => void;
  /** Render after the debounce (typing). */
  schedule: (source: string) => void;
  /** Re-apply highlighting for the current theme. */
  refreshHighlight: () => void;
  /** The preview scroll container — the other half of the scroll sync. */
  scroller: () => HTMLElement;
  destroy: () => void;
};

export function createPreviewPane(host: HTMLElement): PreviewPane {
  const root = document.createElement('div');
  root.className = 'we-preview';
  root.hidden = true;

  const scroller = document.createElement('div');
  scroller.className = 'we-preview-scroll';

  const doc = document.createElement('article');
  doc.className = 'we-preview-doc';

  scroller.appendChild(doc);
  root.appendChild(scroller);
  host.appendChild(root);

  const renderer = createMarkdownRenderer();
  const highlighter: CodeHighlighter = createCodeHighlighter();
  const nodes = new Map<string, BlockNode>();

  let path = '';
  let mdx = false;
  let enabled = false;
  let source = '';
  let timer: number | undefined;
  let frame: number | undefined;

  const clearTimers = () => {
    window.clearTimeout(timer);
    timer = undefined;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };

  const reset = () => {
    clearTimers();
    nodes.clear();
    doc.textContent = '';
    source = '';
    scroller.scrollTop = 0;
  };

  const enhanceCode = () => {
    if (!enabled) return;
    const theme = currentTheme();
    for (const box of doc.querySelectorAll<HTMLElement>('.md-code')) {
      const codeEl = box.querySelector('code');
      if (!codeEl) continue;
      const code = codeEl.textContent ?? '';
      if (!code.trim() || code.length > MAX_HIGHLIGHT_CHARS) continue;
      const lang = (box.dataset.lang || 'text').toLowerCase();
      const key = `${theme}\u0000${lang}\u0000${code}`;
      if (box.dataset.hlKey === key) continue;
      box.dataset.hlKey = key;

      const apply = (html: string) => {
        // The block may have been patched or the theme changed while the
        // worker was busy; only paint results that still match.
        if (!box.isConnected || box.dataset.hlKey !== key) return;
        box.innerHTML = html;
        box.classList.add('is-highlighted');
      };

      const cached = highlighter.get(lang, code, theme);
      if (cached) {
        apply(cached);
        continue;
      }
      box.classList.remove('is-highlighted');
      void highlighter.highlight(lang, code, theme).then((html) => {
        if (html) apply(html);
      });
    }
  };

  const patch = (blocks: PreviewBlock[]) => {
    if (!blocks.length) {
      nodes.clear();
      doc.innerHTML = '<p class="we-preview-empty">Nothing to preview</p>';
      return;
    }
    if (doc.querySelector('.we-preview-empty')) doc.textContent = '';

    const seen = new Set<string>();
    for (const block of blocks) {
      const key = `${block.line}:${block.end}`;
      seen.add(key);
      let node = nodes.get(key);
      if (!node) {
        const el = document.createElement('div');
        el.className = 'md-block';
        el.dataset.line = String(block.line);
        el.dataset.endLine = String(block.end);
        node = { html: '', el };
        nodes.set(key, node);
      }
      if (node.html !== block.html) {
        node.el.innerHTML = block.html;
        node.html = block.html;
      }
      // appendChild moves existing nodes, keeping DOM order in sync.
      doc.appendChild(node.el);
    }
    for (const [key, node] of nodes) {
      if (seen.has(key)) continue;
      node.el.remove();
      nodes.delete(key);
    }
  };

  const paint = (text: string) => {
    if (!enabled) return;
    const scrollTop = scroller.scrollTop;
    const blocks = renderer.render(text, mdx);
    patch(blocks);
    // Keep the reader's place: patching normally preserves it, but a shorter
    // document can clamp scrollTop, so restore explicitly.
    scroller.scrollTop = scrollTop;
    enhanceCode();
  };

  const schedule = (text: string) => {
    source = text;
    if (!enabled) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        paint(source);
      });
    }, DEBOUNCE_MS);
  };

  const update = (text: string) => {
    source = text;
    clearTimers();
    paint(text);
  };

  const onTheme = () => {
    if (enabled) enhanceCode();
  };
  document.addEventListener('we:theme', onTheme);

  return {
    setPath: (next) => {
      const markdown = isMarkdownPath(next);
      if (next === path) return;
      path = next;
      mdx = isMdxPath(next);
      reset();
      if (!markdown) {
        enabled = false;
        root.hidden = true;
      }
    },
    setEnabled: (on) => {
      const next = on && isMarkdownPath(path);
      if (next === enabled) {
        root.hidden = !next;
        return;
      }
      enabled = next;
      root.hidden = !next;
      if (!next) clearTimers();
    },
    update,
    schedule,
    refreshHighlight: enhanceCode,
    scroller: () => scroller,
    destroy: () => {
      document.removeEventListener('we:theme', onTheme);
      clearTimers();
      highlighter.destroy();
      nodes.clear();
      root.remove();
    },
  };
}
