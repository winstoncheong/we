// CodeMirror chrome + syntax produced from the same Pierre theme the rest of
// the app uses, so the editor never disagrees with the shell around it.

import type { Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t, type Tag } from '@lezer/highlight';
import { MONO_FONT, scopeStyle, type AppTheme } from '../theme/pierre';

// CodeMirror tag -> TextMate scope, in the vocabulary Pierre's themes speak.
const TAG_SCOPES: ReadonlyArray<readonly [Tag, string]> = [
  [t.comment, 'comment'],
  [t.lineComment, 'comment'],
  [t.blockComment, 'comment'],
  [t.docComment, 'comment'],
  [t.keyword, 'keyword'],
  [t.controlKeyword, 'keyword.control'],
  [t.definitionKeyword, 'keyword.control'],
  [t.moduleKeyword, 'keyword.control'],
  [t.operatorKeyword, 'keyword.operator.expression'],
  [t.self, 'variable.language'],
  [t.null, 'constant.language'],
  [t.atom, 'constant.language'],
  [t.bool, 'constant.language.boolean'],
  [t.number, 'constant.numeric'],
  [t.integer, 'constant.numeric'],
  [t.float, 'constant.numeric'],
  [t.string, 'string'],
  [t.docString, 'string'],
  [t.character, 'string'],
  [t.attributeValue, 'string'],
  [t.special(t.string), 'string.regexp'],
  [t.regexp, 'string.regexp'],
  [t.escape, 'constant.character.escape'],
  [t.constant(t.name), 'constant'],
  [t.variableName, 'variable'],
  [t.definition(t.variableName), 'variable'],
  [t.local(t.variableName), 'variable'],
  [t.special(t.variableName), 'variable.other.constant'],
  [t.propertyName, 'meta.object-literal.key'],
  [t.attributeName, 'entity.other.attribute-name'],
  [t.typeName, 'entity.name.type'],
  [t.className, 'entity.name.class'],
  [t.namespace, 'entity.name.namespace'],
  [t.macroName, 'entity.name.function'],
  [t.function(t.variableName), 'entity.name.function'],
  [t.function(t.propertyName), 'entity.name.function'],
  [t.labelName, 'entity.name.label'],
  [t.operator, 'keyword.operator'],
  [t.derefOperator, 'keyword.operator'],
  [t.arithmeticOperator, 'keyword.operator.arithmetic'],
  [t.logicOperator, 'keyword.operator.logical'],
  [t.bitwiseOperator, 'keyword.operator.bitwise'],
  [t.compareOperator, 'keyword.operator.comparison'],
  [t.updateOperator, 'keyword.operator.increment'],
  [t.definitionOperator, 'keyword.operator.assignment'],
  [t.typeOperator, 'keyword.operator'],
  [t.controlOperator, 'keyword.operator'],
  [t.punctuation, 'punctuation'],
  [t.bracket, 'punctuation'],
  [t.separator, 'punctuation'],
  [t.angleBracket, 'punctuation'],
  [t.squareBracket, 'punctuation'],
  [t.paren, 'punctuation'],
  [t.brace, 'punctuation'],
  [t.tagName, 'entity.name.tag'],
  [t.heading, 'markup.heading'],
  [t.link, 'markup.underline.link'],
  [t.url, 'markup.underline.link'],
  [t.emphasis, 'markup.italic'],
  [t.strong, 'markup.bold'],
  [t.strikethrough, 'markup.strikethrough'],
  [t.quote, 'markup.quote.markdown'],
  [t.monospace, 'markup.inline.raw.markdown'],
  [t.list, 'punctuation.definition.list.begin.markdown'],
  [t.inserted, 'markup.inserted.diff'],
  [t.deleted, 'markup.deleted.diff'],
  [t.changed, 'markup.changed.diff'],
  [t.invalid, 'invalid.illegal'],
  [t.meta, 'comment'],
  [t.annotation, 'meta.decorator'],
  [t.processingInstruction, 'punctuation'],
  [t.documentMeta, 'comment'],
];

function highlightStyle(theme: AppTheme): HighlightStyle {
  const specs = TAG_SCOPES.flatMap(([tag, scope]) => {
    const style = scopeStyle(theme, scope);
    if (!style) return [];
    const spec: { color: string; fontStyle?: string } = { color: style.color };
    if (style.fontStyle === 'italic') spec.fontStyle = 'italic';
    if (style.fontStyle === 'bold') spec.fontStyle = 'bold';
    return [{ tag, ...spec }];
  });
  return HighlightStyle.define(specs);
}

export function editorTheme(theme: AppTheme): Extension[] {
  const c = theme.colors;
  const bg = c['editor.background'] ?? '#0a0a0a';
  const fg = c['editor.foreground'] ?? '#fafafa';
  const dim = c['editorLineNumber.foreground'] ?? '#737373';
  const activeLineNo = c['editorLineNumber.activeForeground'] ?? fg;
  // The theme's highlight band reads as a blue wash in the shell; a neutral
  // 3% tint keeps the current line visible without competing with the chrome.
  const activeLine =
    theme.scheme === 'dark' ? 'rgb(255 255 255 / 0.032)' : 'rgb(0 0 0 / 0.032)';
  const selection = c['editor.selectionBackground'] ?? '#009fff4d';
  const matchBg = c['selection.background'] ?? selection;
  const cursor = c['editorCursor.foreground'] ?? '#009fff';
  const indent = c['editorIndentGuide.background'] ?? '#1d1d1d';
  const indentActive = c['editorIndentGuide.activeBackground'] ?? '#262626';
  const accent = c['focusBorder'] ?? '#009fff';
  const error = c['gitDecoration.deletedResourceForeground'] ?? '#ff2e3f';
  const panel = c['panel.background'] ?? bg;
  const panelBorder = c['panel.border'] ?? indent;
  const inputBg = c['input.background'] ?? bg;
  const inputBorder = c['input.border'] ?? indent;

  const chrome = EditorView.theme(
    {
      '&': {
        color: fg,
        backgroundColor: bg,
        height: '100%',
        fontSize: '13px',
      },
      '.cm-scroller': {
        fontFamily: MONO_FONT,
        lineHeight: '20px',
        fontVariantLigatures: 'none',
      },
      '.cm-content': {
        caretColor: cursor,
        padding: '10px 0 40vh 0',
      },
      '.cm-line': { padding: '0 16px 0 12px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: cursor, borderLeftWidth: '2px' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        { backgroundColor: selection },
      '.cm-selectionMatch': { backgroundColor: matchBg },
      '.cm-activeLine': { backgroundColor: activeLine },
      '.cm-gutters': {
        backgroundColor: bg,
        color: dim,
        border: 'none',
        paddingLeft: '8px',
      },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: activeLineNo },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px', minWidth: '36px' },
      '.cm-foldGutter .cm-gutterElement': { padding: '0 4px' },
      '.cm-indent-guide, .cm-foldPlaceholder': { color: dim },
      '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
        backgroundColor: 'transparent',
        outline: `1px solid ${accent}`,
        color: fg,
      },
      '.cm-nonmatchingBracket': { color: error },
      '.cm-panels': { backgroundColor: panel, color: fg },
      '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${panelBorder}` },
      '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${panelBorder}` },
      '.cm-searchMatch': { backgroundColor: accent, opacity: '0.35', outline: `1px solid ${selection}` },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: selection, opacity: '1' },
      '.cm-panel input, .cm-panel button': {
        fontFamily: MONO_FONT,
        fontSize: '12px',
        backgroundColor: inputBg,
        color: fg,
        border: `1px solid ${inputBorder}`,
        borderRadius: '0',
        padding: '2px 6px',
      },
      '.cm-tooltip': {
        backgroundColor: inputBg,
        border: `1px solid ${indentActive}`,
        color: fg,
        fontFamily: MONO_FONT,
      },
      '&.cm-focused .cm-matchingBracket': { backgroundColor: 'transparent' },
      '.cm-placeholder': { color: dim },
      '.cm-gutterElement span[title="Fold line"], .cm-gutterElement span[title="Unfold line"]': {
        opacity: '0.4',
      },
      // Vim block cursor & mode class hook.
      '.cm-vimMode .cm-cursor': { borderLeftColor: cursor },
      '.cm-fat-cursor': { background: cursor, color: bg },
      '.cm-fat-cursor ::selection': { background: 'transparent' },
    },
    { dark: theme.scheme === 'dark' },
  );

  const indentExtension = EditorView.baseTheme({
    '.cm-scroller .cm-indent-guide': { borderLeft: `1px solid ${indent}` },
  });

  return [chrome, indentExtension, syntaxHighlighting(highlightStyle(theme))];
}
