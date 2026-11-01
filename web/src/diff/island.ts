// Full-screen diff view. The heavy lifting is done by @pierre/diffs; the
// server hands us the patch and the two file versions.

type DiffPayload = {
  path: string;
  status: string;
  patch: string;
  original: string;
  current: string;
  message: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function mountDiff(container: HTMLElement) {
  const path = container.dataset.path ?? '';
  const status = document.getElementById('diff-status');
  const meta = document.getElementById('diff-meta');

  const response = await fetch(`/api/diff?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    container.innerHTML = '<div class="diff-placeholder">cannot load diff</div>';
    return;
  }
  const data = (await response.json()) as DiffPayload;

  if (status) status.textContent = data.status || 'clean';
  if (meta) meta.textContent = data.message || data.path;

  if (!data.patch) {
    container.innerHTML = `<div class="diff-placeholder">${escapeHtml(data.message || 'no changes')}</div>`;
    return;
  }

  // Placeholder renderer; replaced by the @pierre/diffs integration.
  container.innerHTML = `<pre class="diff-fallback">${escapeHtml(data.patch)}</pre>`;
}
