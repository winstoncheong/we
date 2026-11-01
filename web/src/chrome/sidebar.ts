// Sidebar collapse: one class on `#sidebar`, persisted in localStorage.
// The app.css layout is not touched; chrome.css owns the animation.

const KEY = 'we:sidebar';

export type SidebarState = 'open' | 'collapsed';

export function readSidebar(): SidebarState {
  try {
    return localStorage.getItem(KEY) === 'collapsed' ? 'collapsed' : 'open';
  } catch {
    return 'open';
  }
}

function writeSidebar(state: SidebarState) {
  try {
    localStorage.setItem(KEY, state);
  } catch {
    /* private mode */
  }
}

export function applySidebar(state: SidebarState) {
  const sidebar = document.getElementById('sidebar');
  const collapsed = state === 'collapsed';
  sidebar?.classList.toggle('is-collapsed', collapsed);
  document.documentElement.classList.toggle('sidebar-collapsed', collapsed);

  for (const button of document.querySelectorAll<HTMLElement>('[data-sidebar-toggle]')) {
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = collapsed ? 'Show sidebar (Ctrl B)' : 'Hide sidebar (Ctrl B)';
    const icon = button.querySelector<HTMLElement>('.chrome-icon');
    if (icon) icon.textContent = collapsed ? '▏' : '▤';
  }
}

export function toggleSidebar() {
  const next: SidebarState = readSidebar() === 'open' ? 'collapsed' : 'open';
  applySidebar(next);
  writeSidebar(next);
}
