// Markdown → sanitized HTML blocks for the preview pane.
//
// The renderer keeps line numbers intact so the preview can be mapped back to
// the editor: MDX module lines are blanked (not removed) and every top-level
// block carries `data-line` from `token.map`. MDX is deliberately "lite":
// import/export lines disappear, JSX tags and `{expressions}` become inert
// chips. Nothing is ever evaluated — MDX here is markup, not a module.

import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import type { RuleBlock } from 'markdown-it/lib/parser_block.mjs';
import type Token from 'markdown-it/lib/token.mjs';

export type PreviewBlock = {
  /** 0-based first source line. */
  line: number;
  /** 0-based exclusive end line. */
  end: number;
  /** Sanitized HTML for this top-level block. */
  html: string;
};

export type MarkdownRenderer = {
  render: (source: string, mdx: boolean) => PreviewBlock[];
};

type FenceToken = Token & { info: string; content: string };

const TAG_NAME = /[A-Za-z_$][\w$.-]*/;

/** Blank MDX `import`/`export` statements without touching line numbers. */
function stripMdxModuleLines(source: string): string {
  const lines = source.split('\n');
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    if (!/^\s*(import|export)\b/.test(line)) continue;
    lines[i] = '';
    // Multi-line imports/exports: blank the continuation lines too, keeping
    // the total line count (and therefore every following source map) intact.
    let depth = braceDelta(line);
    let j = i + 1;
    while (depth > 0 && j < lines.length) {
      depth += braceDelta(lines[j]);
      lines[j] = '';
      j += 1;
    }
  }
  return lines.join('\n');
}

function braceDelta(line: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
  }
  return depth;
}

function compact(text: string, limit = 72): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > limit ? `${oneLine.slice(0, limit - 1)}…` : oneLine;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function chip(text: string, kind: 'expression' | 'jsx', block = false): string {
  const label = compact(text);
  const cls = block ? 'mdx-chip mdx-chip-block' : 'mdx-chip';
  return `<span class="${cls}" data-mdx="${kind}" title="${escapeAttr(text)}">${escapeAttr(label)}</span>`;
}

/** Find the matching `}` for an MDX expression, respecting strings. */
function scanExpression(src: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const close = scanString(src, i);
      if (close < 0) return -1;
      i = close + 1;
      continue;
    }
    if (ch === '\n' && depth === 0) return -1;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function scanString(src: string, start: number): number {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i;
    if (quote !== '`' && ch === '\n') return -1;
    i += 1;
  }
  return -1;
}

/** Scan a JSX tag starting at `<`; returns the index of its `>` or -1. */
function scanTag(src: string, start: number): number {
  let i = start + 1;
  if (src[i] === '>') return i; // fragment <>
  if (src[i] === '/') {
    i += 1;
    if (src[i] === '>') return i; // fragment </>
  }
  if (!/[A-Za-z_$]/.test(src[i] ?? '')) return -1;
  const nameMatch = TAG_NAME.exec(src.slice(i));
  if (!nameMatch) return -1;
  i += nameMatch[0].length;
  // `https://…` / `mailto:…` are autolinks, not tags.
  if (src[i] === ':') return -1;

  let quote: string | null = null;
  let braces = 0;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '{') braces += 1;
    else if (ch === '}') braces -= 1;
    else if (ch === '>' && braces === 0) return i;
    else if (ch === '<' || ch === '\n') return -1;
    i += 1;
  }
  return -1;
}

function mdxInlinePlugin(md: MarkdownIt) {
  md.inline.ruler.before('backticks', 'mdx_expression', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x7b) return false;
    const end = scanExpression(state.src, state.pos);
    if (end < 0) return false;
    if (!silent) {
      const token = state.push('mdx_expression', '', 0);
      token.content = state.src.slice(state.pos, end + 1);
    }
    state.pos = end + 1;
    return true;
  });

  md.inline.ruler.before('autolink', 'mdx_tag', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c) return false;
    const end = scanTag(state.src, state.pos);
    if (end < 0) return false;
    if (!silent) {
      const token = state.push('mdx_tag', '', 0);
      token.content = state.src.slice(state.pos, end + 1);
    }
    state.pos = end + 1;
    return true;
  });
}

/**
 * Block-level JSX: a line that opens a JSX element is consumed until its tag
 * balance closes (or 80 lines pass). Everything inside is shown as one chip —
 * MDX children are markdown in real MDX, but we never evaluate or expand them.
 */
function mdxBlockPlugin(md: MarkdownIt) {
  const blockRule: RuleBlock = (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const first = state.src.slice(start, state.eMarks[startLine]).trim();
    if (!first.startsWith('<') || first.startsWith('</')) return false;
    // Ignore autolinks and inline expressions at the start of a paragraph.
    if (/^<[A-Za-z][A-Za-z0-9+.-]*:/.test(first)) return false;
    if (!/^<(\/|>|[A-Za-z_$])/.test(first)) return false;

    let depth = 0;
    let sawTag = false;
    let last = startLine;
    let closed = false;
    const limit = Math.min(endLine, startLine + 80);
    for (let line = startLine; line < limit; line += 1) {
      const text = state.src.slice(
        state.bMarks[line] + state.tShift[line],
        state.eMarks[line],
      );
      const tags = text.match(/<>|<\/>|<\/?[A-Za-z_$][\w$.-]*(?:[^<>"']|"[^"]*"|'[^']*')*?\/?>/g);
      if (tags) {
        for (const tag of tags) {
          if (tag === '<>') {
            depth += 1;
            sawTag = true;
          } else if (tag === '</>') {
            depth -= 1;
          } else if (tag.startsWith('</')) {
            depth -= 1;
          } else if (tag.endsWith('/>')) {
            sawTag = true;
          } else {
            depth += 1;
            sawTag = true;
          }
        }
      }
      last = line;
      if (sawTag && depth <= 0) {
        closed = true;
        break;
      }
    }
    if (!closed) return false;
    if (silent) return true;

    const token = state.push('mdx_block', 'div', 0);
    token.map = [startLine, last + 1];
    token.content = state.src.slice(start, state.eMarks[last]);
    state.line = last + 1;
    return true;
  };
  md.block.ruler.before('paragraph', 'mdx_block', blockRule);
}

/** Write `data-line` from `token.map` on every top-level block. */
function sourceMapPlugin(md: MarkdownIt) {
  md.core.ruler.push('source_map', (state) => {
    for (const token of state.tokens) {
      if (token.map && token.level === 0 && token.nesting !== -1 && token.type !== 'inline') {
        token.attrSet('data-line', String(token.map[0]));
      }
    }
  });
}

/** GitHub-style task list items: `- [ ] todo` / `- [x] done`. */
function taskListPlugin(md: MarkdownIt) {
  md.core.ruler.after('inline', 'task_lists', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i += 1) {
      const inline = tokens[i];
      if (inline.type !== 'inline' || !inline.children) continue;
      const paragraph = tokens[i - 1];
      if (!paragraph || paragraph.type !== 'paragraph_open') continue;
      const match = /^\[([ xX])\](?:[ \t]+|$)/.exec(inline.content);
      if (!match) continue;

      const prefix = match[0].length;
      let removed = 0;
      for (const child of inline.children) {
        if (child.type !== 'text') break;
        const cut = Math.min(prefix - removed, child.content.length);
        child.content = child.content.slice(cut);
        removed += cut;
        if (removed >= prefix) break;
      }
      inline.content = inline.content.slice(prefix);

      const done = match[1].toLowerCase() === 'x';
      const checkbox = new state.Token('html_inline', '', 0);
      checkbox.content = `<input type="checkbox" class="md-task-box" disabled${
        done ? ' checked' : ''
      }>`;
      inline.children.unshift(checkbox);

      const item = findParent(tokens, i - 1, paragraph.level - 1, '_open');
      if (item) {
        item.attrJoin('class', 'md-task-item');
        const list = findParent(tokens, tokens.indexOf(item) - 1, item.level - 1, '_open');
        if (list && (list.type === 'bullet_list_open' || list.type === 'ordered_list_open')) {
          list.attrJoin('class', 'md-task-list');
        }
      }
    }
  });
}

function findParent(
  tokens: Token[],
  from: number,
  level: number,
  suffix: string,
): Token | undefined {
  for (let i = from; i >= 0; i -= 1) {
    const token = tokens[i];
    if (token.level === level && token.type.endsWith(suffix)) return token;
  }
  return undefined;
}

function configure(md: MarkdownIt, mdx: boolean): MarkdownIt {
  md.set({
    html: false,
    linkify: true,
    breaks: false,
    typographer: false,
  });

  sourceMapPlugin(md);
  taskListPlugin(md);

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx] as FenceToken;
    const info = token.info.trim().split(/\s+/)[0] ?? '';
    const lang = info ? info.toLowerCase() : 'text';
    const line = token.attrGet('data-line');
    return `<div class="md-code" data-lang="${escapeAttr(lang)}"${
      line ? ` data-line="${line}"` : ''
    }><pre class="md-code-plain"><code>${md.utils.escapeHtml(token.content)}</code></pre></div>`;
  };

  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const href = token.attrGet('href') ?? '';
    if (/^(https?:)?\/\//i.test(href) || href.startsWith('mailto:')) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noreferrer noopener');
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  if (mdx) {
    mdxInlinePlugin(md);
    mdxBlockPlugin(md);
    md.renderer.rules.mdx_expression = (tokens, idx) => chip(tokens[idx].content, 'expression');
    md.renderer.rules.mdx_tag = (tokens, idx) => chip(tokens[idx].content, 'jsx');
    md.renderer.rules.mdx_block = (tokens, idx) => {
      const token = tokens[idx];
      const line = token.attrGet('data-line');
      const label = compact(token.content);
      return `<span class="mdx-chip mdx-chip-block"${
        line ? ` data-line="${line}"` : ''
      } data-mdx="jsx" title="${escapeAttr(token.content)}">${escapeAttr(label)}</span>`;
    };
  }

  return md;
}

/** Split the token stream into top-level blocks and render each separately. */
function renderBlocks(md: MarkdownIt, source: string): PreviewBlock[] {
  const tokens = md.parse(source, {});
  const groups: Token[][] = [];
  for (const token of tokens) {
    const startsBlock =
      token.level === 0 && token.map !== null && token.nesting !== -1 && token.type !== 'inline';
    if (startsBlock || groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(token);
  }

  const blocks: PreviewBlock[] = [];
  for (const group of groups) {
    const first = group.find((token) => token.map);
    if (!first) continue;
    const line = first.map?.[0] ?? 0;
    let end = line;
    for (const token of group) {
      if (token.map) end = Math.max(end, token.map[1]);
    }
    const html = md.renderer.render(group, md.options, {});
    const clean = DOMPurify.sanitize(html, {
      ADD_ATTR: ['data-line', 'data-lang', 'data-mdx', 'checked', 'disabled', 'target', 'rel'],
    });
    blocks.push({ line, end: Math.max(end, line + 1), html: String(clean) });
  }
  return blocks;
}

export function createMarkdownRenderer(): MarkdownRenderer {
  let plain: MarkdownIt | undefined;
  let mdx: MarkdownIt | undefined;

  return {
    render: (source, useMdx) => {
      const normalized = useMdx ? stripMdxModuleLines(source) : source;
      if (useMdx) {
        mdx ??= configure(new MarkdownIt(), true);
        return renderBlocks(mdx, normalized);
      }
      plain ??= configure(new MarkdownIt(), false);
      return renderBlocks(plain, normalized);
    },
  };
}
