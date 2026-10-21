// Filesystem abstraction with three backends:
// 1. Tauri native (full local FS) when running under `npm run tauri dev`.
// 2. File System Access API (real folder access in Chrome/Edge) under `npm run dev`.
// 3. In-memory demo files otherwise (e.g. Firefox, which lacks the picker API).

const DEMO_FILES: Record<string, string> = {
  'welcome.md':
    '# my-editor\n\nThin local editor. Open a folder to edit real files.\n\n- Ctrl+P quick open\n- Ctrl+Shift+P commands\n- Ctrl+S save, Ctrl+W close tab\n',
  'example.py': 'def greet(name: str) -> str:\n    return f"hello, {name}"\n\n\nif __name__ == "__main__":\n    print(greet("world"))\n',
  'example.tex':
    '\\documentclass{article}\n\\begin{document}\nHello, LaTeX! Vim motion works here too.\n\\end{document}\n',
  'index.html':
    '<!doctype html>\n<html>\n  <body>\n    <h1>hi</h1>\n    <script src="app.js"></script>\n  </body>\n</html>\n',
  'app.js': 'const el = document.querySelector("h1");\nconsole.log("hi", el?.textContent);\n',
};

const demoStore = new Map<string, string>(Object.entries(DEMO_FILES));

// Minimal File System Access API declarations (not in this TS lib yet).
declare global {
  interface Window {
    showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
  }
}

// File System Access API root, set by pickFolder() in browser mode.
let browserRoot: FileSystemDirectoryHandle | null = null;

export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

export function supportsBrowserFS(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function backendLabel(): string {
  if (isTauri()) return 'tauri';
  if (browserRoot) return 'browser fs';
  return 'browser demo';
}

export async function pickFolder(): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === 'string' ? selected : null;
  }
  if (supportsBrowserFS()) {
    try {
      const picked = await window.showDirectoryPicker();
      browserRoot = picked;
      return picked.name;
    } catch {
      return null; // user cancelled the picker
    }
  }
  return null;
}

type DirEntry = {
  name?: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
};

async function readDirRecursive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readDirFn: any,
  root: string,
  out: string[],
): Promise<void> {
  const entries: DirEntry[] = await readDirFn(root);
  for (const e of entries) {
    if (e.isDirectory) {
      await readDirRecursive(readDirFn, e.path, out);
    } else if (e.isFile) {
      out.push(e.path);
    }
  }
}

async function walkBrowser(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: string[],
): Promise<void> {
  for await (const entry of dir.values()) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      await walkBrowser(entry as FileSystemDirectoryHandle, rel, out);
    } else {
      out.push(rel);
    }
  }
}

async function resolveBrowserFile(
  relPath: string,
  create: boolean,
): Promise<FileSystemFileHandle | null> {
  if (!browserRoot) return null;
  const parts = relPath.split('/');
  let dir = browserRoot;
  for (const p of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(p, { create });
  }
  return dir.getFileHandle(parts[parts.length - 1], { create });
}

export async function listFilesRecursive(root: string): Promise<string[]> {
  if (isTauri()) {
    const { readDir } = await import('@tauri-apps/plugin-fs');
    const abs: string[] = [];
    await readDirRecursive(readDir, root, abs);
    // Convert to paths relative to root for @pierre/trees.
    const normRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
    return abs
      .map((p) => {
        const n = p.replace(/\\/g, '/');
        return n.startsWith(normRoot + '/') ? n.slice(normRoot.length + 1) : n;
      })
      .sort();
  }
  if (browserRoot) {
    const out: string[] = [];
    await walkBrowser(browserRoot, '', out);
    return out.sort();
  }
  return [];
}

export async function readFile(root: string | null, relPath: string): Promise<string> {
  if (isTauri() && root !== null) {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');
    const full = await join(root, relPath);
    return await readTextFile(full);
  }
  if (browserRoot) {
    const h = await resolveBrowserFile(relPath, false);
    if (!h) throw new Error(`cannot resolve ${relPath}`);
    return await (await h.getFile()).text();
  }
  return demoStore.get(relPath) ?? '';
}

export async function writeFile(
  root: string | null,
  relPath: string,
  content: string,
): Promise<void> {
  if (isTauri() && root !== null) {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');
    const full = await join(root, relPath);
    await writeTextFile(full, content);
    return;
  }
  if (browserRoot) {
    const h = await resolveBrowserFile(relPath, true);
    if (!h) throw new Error(`cannot resolve ${relPath}`);
    const w = await h.createWritable();
    await w.write(content);
    await w.close();
    return;
  }
  demoStore.set(relPath, content);
}

export function demoPaths(): string[] {
  return Object.keys(DEMO_FILES).sort();
}
