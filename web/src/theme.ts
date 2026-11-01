// Theme is a document-level concern: one class on <html>, persisted locally.
// Islands subscribe to `we:theme` and re-skin themselves.

export type ThemeMode = 'dark' | 'light';

const KEY = 'we:theme';

export function currentTheme(): ThemeMode {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle('light', mode === 'light');
  root.classList.toggle('dark', mode === 'dark');
  root.dataset.theme = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode */
  }
  document.dispatchEvent(new CustomEvent('we:theme', { detail: { theme: mode } }));
}

export function toggleTheme() {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

export function setupTheme() {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('#theme-toggle')) toggleTheme();
  });
}

export function token(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="we-token"]')?.content ?? '';
}
