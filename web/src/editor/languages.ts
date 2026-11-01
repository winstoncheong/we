// Language resolution for CodeMirror. `@codemirror/language-data` carries the
// registry for ~130 syntaxes (lezer parsers where they exist, stream modes
// otherwise) and loads each one lazily as its own chunk, so adding languages
// costs nothing until a file of that type is opened.

import { LanguageDescription, type LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

/** Best description for a workspace path (extension, then basename). */
export function describeLanguage(path: string): LanguageDescription | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const byFilename = LanguageDescription.matchFilename(languages, name);
  if (byFilename) return byFilename;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return ext ? LanguageDescription.matchLanguageName(languages, ext) : null;
}

/** Loads a language on demand; resolves to null when none matches. */
export async function loadLanguage(path: string): Promise<LanguageSupport | null> {
  const description = describeLanguage(path);
  if (!description) return null;
  try {
    return await description.load();
  } catch {
    return null;
  }
}
