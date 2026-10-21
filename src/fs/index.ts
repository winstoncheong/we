// Filesystem abstraction: Tauri native when available, in-memory demo otherwise.
// Keeps `npm run dev` (browser) usable without Tauri, and `npm run tauri dev`
// fully local-native.

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

export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === 'string' ? selected : null;
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
      // Store relative to root for the tree, keep absolute for IO.
      out.push(e.path);
    }
  }
}

export async function listFilesRecursive(root: string): Promise<string[]> {
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

export async function readFile(root: string | null, relPath: string): Promise<string> {
  if (!isTauri() || root === null) {
    return demoStore.get(relPath) ?? '';
  }
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  const { join } = await import('@tauri-apps/api/path');
  const full = await join(root, relPath);
  return await readTextFile(full);
}

export async function writeFile(
  root: string | null,
  relPath: string,
  content: string,
): Promise<void> {
  if (!isTauri() || root === null) {
    demoStore.set(relPath, content);
    return;
  }
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  const { join } = await import('@tauri-apps/api/path');
  const full = await join(root, relPath);
  await writeTextFile(full, content);
}

export function demoPaths(): string[] {
  return Object.keys(DEMO_FILES).sort();
}
