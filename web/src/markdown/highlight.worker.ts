// Fenced-code highlighting runs in a worker so a paste of a large file never
// stalls typing. @pierre/highlights is a WebAssembly highlighter (already a
// transitive dependency of @pierre/diffs); its Pierre themes keep code blocks
// consistent with the editor and diff views.

import { codeToHtml, isSupportedLanguage } from '@pierre/highlights';
import { pierreDark, pierreLight } from '@pierre/highlights/themes';

type Request = {
  id: number;
  code: string;
  lang: string;
  theme: 'dark' | 'light';
};

type Reply = { id: number; html?: string; error?: string };

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: Reply) => void;
};

const decoder = new TextDecoder();

ctx.onmessage = (event) => {
  const { id, code, lang, theme } = event.data;
  try {
    const use = isSupportedLanguage(lang) ? lang : 'text';
    const bytes = codeToHtml(code, {
      lang: use,
      theme: theme === 'light' ? pierreLight : pierreDark,
    });
    ctx.postMessage({ id, html: decoder.decode(bytes) });
  } catch (error) {
    ctx.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
