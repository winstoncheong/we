const MARKDOWN = /\.(md|mdx|markdown)$/i;
const MDX = /\.mdx$/i;

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN.test(path);
}

export function isMdxPath(path: string): boolean {
  return MDX.test(path);
}
