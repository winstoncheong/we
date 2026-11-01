// Palette commands. Pure client-side when they only touch the DOM; htmx or the
// existing endpoints when state has to round-trip.

import { toggleTheme } from '../theme';
import { activePath, action } from './htmx';
import { toggleSidebar } from './sidebar';

export type CommandId =
  | 'toggle-theme'
  | 'toggle-sidebar'
  | 'save-all'
  | 'close-tab'
  | 'open-diff'
  | 'preview-toggle';

export function runCommand(id: string) {
  switch (id) {
    case 'toggle-theme':
      toggleTheme();
      break;
    case 'toggle-sidebar':
      toggleSidebar();
      break;
    case 'save-all':
      saveAll();
      break;
    case 'close-tab':
      closeActiveTab();
      break;
    case 'open-diff':
      openDiff();
      break;
    case 'preview-toggle':
      togglePreview();
      break;
    default:
      break;
  }
}

/**
 * Saving lives in the editor island (Ctrl+S) because it owns the buffer text.
 * Re-dispatch the same chord so "Save all" and the shortcut take one path.
 */
function saveAll() {
  document.dispatchEvent(new CustomEvent('we:save-all'));
}

export function closeActiveTab() {
  const path = activePath();
  if (!path) return;
  void action('/actions/close', { path });
}

function openDiff() {
  const link = document.querySelector<HTMLAnchorElement>('a[href^="/diff?path="]');
  if (link) window.location.assign(link.getAttribute('href') ?? '/');
}

/**
 * The preview island (when it lands) listens for this and splits the editor.
 * Firing the event keeps the command useful even before the island exists.
 */
function togglePreview() {
  const path = activePath();
  document.dispatchEvent(
    new CustomEvent('we:preview-toggle', { detail: { path, open: true } }),
  );
}
