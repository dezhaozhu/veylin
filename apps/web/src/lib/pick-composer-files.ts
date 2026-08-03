import { isTauri } from '@/lib/tauri-web-view';

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (/\.(png)$/.test(lower)) return 'image/png';
  if (/\.(jpe?g)$/.test(lower)) return 'image/jpeg';
  if (/\.(gif)$/.test(lower)) return 'image/gif';
  if (/\.(webp)$/.test(lower)) return 'image/webp';
  if (/\.(svg)$/.test(lower)) return 'image/svg+xml';
  if (/\.(pdf)$/.test(lower)) return 'application/pdf';
  if (/\.(json|jsonc|json5)$/.test(lower)) return 'application/json';
  if (/\.(ya?ml)$/.test(lower)) return 'application/yaml';
  if (/\.(md|markdown)$/.test(lower)) return 'text/markdown';
  if (/\.(csv)$/.test(lower)) return 'text/csv';
  if (/\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro)$/.test(lower)) return 'text/plain';
  if (/\.(txt|log|toml|ini|cfg|conf|env)$/.test(lower)) return 'text/plain';
  return 'application/octet-stream';
}

async function pickFilesViaHtml(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = () => {
      const list = input.files ? Array.from(input.files) : [];
      document.body.removeChild(input);
      resolve(list);
    };
    input.oncancel = () => {
      document.body.removeChild(input);
      resolve([]);
    };
    input.click();
  });
}

async function pickFilesViaTauri(multiple: boolean): Promise<File[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const selected = await open({
    multiple,
    directory: false,
    title: 'Open',
  });
  if (selected == null) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  const files: File[] = [];
  for (const path of paths) {
    const bytes = await readFile(path);
    const name = basename(path);
    // Copy into a plain ArrayBuffer-backed Uint8Array for the File constructor.
    const copy = new Uint8Array(bytes);
    files.push(new File([copy], name, { type: guessMime(name) }));
  }
  return files;
}

/**
 * Open a file picker. On Tauri desktop this uses the native dialog (centered on
 * the app window); in the browser it falls back to `<input type="file">`.
 */
export async function pickComposerFiles(options?: {
  accept?: string;
  multiple?: boolean;
}): Promise<File[]> {
  const multiple = options?.multiple ?? true;
  const accept = options?.accept ?? '*/*';
  if (isTauri()) {
    try {
      return await pickFilesViaTauri(multiple);
    } catch (err) {
      console.warn('[pickComposerFiles] Tauri dialog failed, falling back to input', err);
    }
  }
  return pickFilesViaHtml(accept, multiple);
}
