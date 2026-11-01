import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { stex } from '@codemirror/legacy-modes/mode/stex';

const latex = StreamLanguage.define(stex);

export function languageForPath(path: string): Extension {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'py':
      return python();
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'ts':
    case 'tsx':
    case 'jsx':
      return javascript({ typescript: ext.includes('ts') });
    case 'html':
    case 'htm':
    case 'xml':
      return html();
    case 'md':
    case 'mdx':
    case 'markdown':
      return markdown();
    case 'json':
      return json();
    case 'tex':
    case 'sty':
    case 'cls':
    case 'bib':
      return latex;
    default:
      return [];
  }
}

export function languageLabel(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'py':
      return 'Python';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'JavaScript';
    case 'ts':
    case 'tsx':
      return 'TypeScript';
    case 'html':
    case 'htm':
      return 'HTML';
    case 'tex':
    case 'sty':
    case 'cls':
      return 'LaTeX';
    case 'md':
      return 'Markdown';
    default:
      return 'Text';
  }
}
