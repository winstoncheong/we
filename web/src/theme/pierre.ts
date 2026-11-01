// Single source of truth for color: the Pierre theme itself.
//
// Everything the app paints — chrome, file tree, editor chrome, syntax — is
// derived from one Pierre/Shiki theme object, the same way @pierre/diffs and
// @pierre/trees do it. Swap the theme name and the whole app re-skins.

import pierreDark from '@pierre/theme/pierre-dark';
import pierreLight from '@pierre/theme/pierre-light';
import { normalizeThemeColors } from '@pierre/theming/color';

export type ThemeName = 'pierre-dark' | 'pierre-light';

export type TokenRule = {
  scope?: string | string[];
  settings: Readonly<Record<string, string>>;
};

export type AppTheme = {
  name: ThemeName;
  label: string;
  scheme: 'dark' | 'light';
  /** Normalized workbench colors (VS Code vocabulary). */
  colors: Record<string, string>;
  /** CSS custom properties consumed by index.css. */
  vars: Record<string, string>;
  tokenColors: readonly TokenRule[];
};

export const THEME_ORDER: ThemeName[] = ['pierre-dark', 'pierre-light'];

const SOURCES = {
  'pierre-dark': pierreDark,
  'pierre-light': pierreLight,
} as const;

function pick(colors: Record<string, string>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = colors[key];
    if (value) return value;
  }
  return fallback;
}

function build(name: ThemeName): AppTheme {
  const source = SOURCES[name];
  const colors = normalizeThemeColors({
    name: source.name,
    type: source.type,
    bg: source.colors['editor.background'],
    fg: source.colors['editor.foreground'],
    colors: { ...source.colors },
  }).colors as Record<string, string>;

  const bg = pick(colors, ['editor.background'], '#0a0a0a');
  const panel = pick(colors, ['sideBar.background', 'panel.background'], bg);
  const raised = pick(colors, ['input.background', 'dropdown.background', 'notifications.background'], panel);
  const line = pick(colors, ['sideBar.border', 'panel.border'], bg);
  const fg = pick(colors, ['editor.foreground', 'foreground'], '#fafafa');
  const muted = pick(colors, ['sideBar.foreground'], fg);
  const dim = pick(colors, ['editorLineNumber.foreground'], muted);
  const accent = pick(colors, ['focusBorder', 'textLink.foreground', 'button.background'], '#009fff');

  const vars: Record<string, string> = {
    '--bg': bg,
    '--panel': panel,
    '--raised': raised,
    '--line': line,
    '--fg': fg,
    '--muted': muted,
    '--dim': dim,
    '--accent': accent,
    '--selected': pick(colors, ['list.activeSelectionBackground'], accent),
    '--hover': pick(colors, ['list.hoverBackground'], raised),
    '--ok': pick(colors, ['gitDecoration.addedResourceForeground', 'terminal.ansiGreen'], '#07c480'),
    '--warn': pick(colors, ['terminal.ansiYellow', 'gitDecoration.modifiedResourceForeground'], '#ffca00'),
  };

  return {
    name,
    label: source.displayName,
    scheme: source.type,
    colors,
    vars,
    tokenColors: source.tokenColors as readonly TokenRule[],
  };
}

const CACHE = new Map<ThemeName, AppTheme>();

export function getTheme(name: ThemeName): AppTheme {
  const cached = CACHE.get(name);
  if (cached) return cached;
  const theme = build(name);
  CACHE.set(name, theme);
  return theme;
}

export function otherTheme(name: ThemeName): ThemeName {
  return name === 'pierre-dark' ? 'pierre-light' : 'pierre-dark';
}

/**
 * Resolve a TextMate scope against the theme's token colors.
 * Deeper scopes win over their parents; later rules break ties.
 */
export function scopeStyle(
  theme: AppTheme,
  target: string,
): { color: string; fontStyle?: string } | null {
  let bestScore = -1;
  let bestIndex = -1;
  let best: TokenRule | null = null;

  theme.tokenColors.forEach((rule, index) => {
    const scopes = typeof rule.scope === 'string' ? [rule.scope] : (rule.scope ?? []);
    for (const scope of scopes) {
      if (target !== scope && !target.startsWith(`${scope}.`)) continue;
      if (scope.length > bestScore || (scope.length === bestScore && index > bestIndex)) {
        bestScore = scope.length;
        bestIndex = index;
        best = rule;
      }
    }
  });

  if (!best) return null;
  const settings = (best as TokenRule).settings;
  const color = settings.foreground;
  if (!color) return null;
  return { color, fontStyle: settings.fontStyle };
}

export const MONO_FONT =
  "'Berkeley Mono', 'BerkeleyMono', ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
