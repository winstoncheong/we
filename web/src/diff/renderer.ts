// Thin wrapper around the framework-agnostic @pierre/diffs core.
//
// Nothing here may be imported statically by the editor bundle: the library is
// ~460KB of JS plus the Shiki highlighter chunks, so `loadDiffLibrary()` is only
// called from the diff page once the payload has arrived.

import type { FileDiff, FileDiffMetadata, FileDiffOptions } from '@pierre/diffs';

export type DiffLayout = 'unified' | 'split';
export type DiffTheme = 'dark' | 'light';

type Library = typeof import('@pierre/diffs');

let loading: Promise<Library> | null = null;

export function loadDiffLibrary(): Promise<Library> {
  loading ??= import('@pierre/diffs');
  return loading;
}

export type FileInput = {
  path: string;
  /** `null` when the file does not exist on the original side (untracked). */
  original: string | null;
  current: string | null;
  patch: string;
};

/**
 * Build a renderable diff from full file contents. Full contents (rather than
 * the raw patch) let the renderer expand collapsed context between hunks, which
 * is what the diffs.com demos do. The patch is the fallback for the rare case
 * where jsdiff refuses the pair.
 */
export function buildFileDiff(library: Library, input: FileInput): FileDiffMetadata | null {
  const name = input.path;
  try {
    const diff = library.parseDiffFromFile(
      input.original === null ? null : { name, contents: input.original },
      input.current === null ? null : { name, contents: input.current },
    );
    if (diff.hunks.length > 0) return diff;
  } catch {
    // Identical sides: jsdiff will not emit an empty patch.
  }

  if (input.patch.trim()) {
    try {
      const file = library.parsePatchFiles(input.patch)[0]?.files[0];
      if (file != null && file.hunks.length > 0) return file;
    } catch {
      // Unparseable patch: fall through to the empty state.
    }
  }
  return null;
}

export type DiffRendererOptions = {
  layout: DiffLayout;
  theme: DiffTheme;
};

export type DiffRenderer = {
  show(fileDiff: FileDiffMetadata): void;
  setLayout(layout: DiffLayout): void;
  setTheme(theme: DiffTheme): void;
  cleanUp(): void;
};

/**
 * Mount a diff into `host` (the virtualisation content container) inside
 * `scrollRoot` (the element that actually scrolls).
 *
 * The virtualised renderer keeps only the rows around the viewport in the DOM
 * and reserves the rest of the height with a placeholder. It is tried first;
 * the plain renderer is the fallback, so a layout quirk in the virtualizer
 * degrades to "slower" instead of "blank".
 */
export function createDiffRenderer(
  library: Library,
  host: HTMLElement,
  scrollRoot: HTMLElement,
  initial: DiffRendererOptions,
): DiffRenderer {
  const container = document.createElement('diffs-container');
  host.append(container);

  // Replace (never mutate) so the library never sees a silently changed options
  // object: `setThemeType()` compares against `options.themeType` before doing
  // any work, and an aliased mutation would make it a no-op.
  let options: FileDiffOptions<undefined, undefined> = {
    // Naming both themes makes `setThemeType()` a CSS-only switch: no re-parse,
    // no re-highlight.
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    themeType: initial.theme,
    diffStyle: initial.layout,
    diffIndicators: 'bars',
    hunkSeparators: 'line-info',
    lineDiffType: 'word-alt',
    enableLineSelection: true,
  };

  let virtualizer: import('@pierre/diffs').Virtualizer | null = null;
  let instance: FileDiff<undefined, undefined> | null = null;
  let virtualized = true;

  const create = (): FileDiff<undefined, undefined> => {
    if (virtualized) {
      try {
        virtualizer = new library.Virtualizer({ overscrollSize: 1600 });
        virtualizer.setup(scrollRoot, host);
        return new library.VirtualizedFileDiff(options, virtualizer, { lineHeight: 20 });
      } catch (error) {
        console.warn('[we] diff virtualization unavailable, rendering flat', error);
        try {
          virtualizer?.cleanUp();
        } catch {
          /* already gone */
        }
        virtualizer = null;
        virtualized = false;
      }
    }
    return new library.FileDiff(options);
  };

  return {
    show(fileDiff) {
      instance ??= create();
      instance.render({ fileDiff, fileContainer: container });
    },
    setLayout(layout) {
      options = { ...options, diffStyle: layout };
      if (instance == null) return;
      instance.setOptions(options);
      instance.rerender();
    },
    setTheme(theme) {
      options = { ...options, themeType: theme };
      instance?.setThemeType(theme);
    },
    cleanUp() {
      instance?.cleanUp();
      instance = null;
      virtualizer?.cleanUp();
      virtualizer = null;
      container.remove();
    },
  };
}
