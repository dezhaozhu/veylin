import * as XLSX from 'xlsx';
import i18n from '@/i18n';
import { apiUrl } from '@/lib/api-base';

/** Keep in sync with server `RAG_UPLOAD_MAX_BYTES` (default 32 MiB). */
const RAG_UPLOAD_MAX_BYTES = 32 * 1024 * 1024;
const RAG_UPLOAD_MAX_MB = RAG_UPLOAD_MAX_BYTES / (1024 * 1024);

function assertUploadSize(file: File): void {
  if (file.size > RAG_UPLOAD_MAX_BYTES) {
    throw new Error(
      i18n.t('extract.fileTooLarge', { name: file.name, maxMb: RAG_UPLOAD_MAX_MB }),
    );
  }
}

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'log',
  'html',
  'htm',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'cfg',
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'rs',
  'go',
  'java',
  'sql',
  'sh',
  'bash',
  'rtf',
]);

const SPREADSHEET_EXTENSIONS = new Set(['xlsx', 'xls', 'xlsm', 'ods']);

export const RAG_UPLOAD_ACCEPT =
  '.txt,.md,.markdown,.csv,.json,.log,.html,.htm,.xml,.yaml,.yml,.toml,.ini,.conf,.ts,.tsx,.js,.jsx,.py,.rs,.go,.sql,.docx,.xlsx,.xls,.xlsm,.ods,.rtf,.pdf';

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i === -1 ? '' : filename.slice(i + 1).toLowerCase();
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value.trim();
}

function extractSpreadsheet(file: File, buffer: ArrayBuffer): string {
  const wb = XLSX.read(buffer, { type: 'array' });
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    if (!sheet) return '';
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return `## ${name}\n${csv}`;
  })
    .filter(Boolean)
    .join('\n\n');
}

/** PDF text extraction runs on the server (unpdf) — avoids pdfjs ReadableStream issues in WebKit/Tauri. */
async function extractPdf(file: File): Promise<string> {
  assertUploadSize(file);
  const res = await fetch(apiUrl('/api/rag/extract-pdf'), {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: await file.arrayBuffer(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `PDF extract failed (${res.status})`);
  }
  const data = (await res.json()) as { text?: string; message?: string };
  const text = data.text?.trim() ?? '';
  if (!text) {
    throw new Error(data.message || i18n.t('extract.noTextPdf', { name: file.name }));
  }
  return text;
}

export async function extractTextFromFile(file: File): Promise<{ text: string; mimeType: string }> {
  assertUploadSize(file);
  const ext = extOf(file.name);
  const mimeType = file.type || 'application/octet-stream';

  if (ext === 'docx') {
    const text = await extractDocx(file);
    if (!text) throw new Error(i18n.t('extract.noText', { name: file.name }));
    return { text, mimeType: 'text/plain' };
  }

  if (ext === 'pdf' || mimeType === 'application/pdf') {
    const text = await extractPdf(file);
    if (!text) throw new Error(i18n.t('extract.noTextPdf', { name: file.name }));
    return { text, mimeType: 'application/pdf' };
  }

  if (SPREADSHEET_EXTENSIONS.has(ext)) {
    const text = extractSpreadsheet(file, await file.arrayBuffer()).trim();
    if (!text) throw new Error(i18n.t('extract.emptySheet', { name: file.name }));
    return { text, mimeType: 'text/csv' };
  }

  if (TEXT_EXTENSIONS.has(ext) || mimeType.startsWith('text/') || mimeType === 'application/json') {
    const text = (await file.text()).trim();
    if (!text) throw new Error(i18n.t('extract.emptyFile', { name: file.name }));
    return { text, mimeType: mimeType || 'text/plain' };
  }

  throw new Error(i18n.t('extract.unsupported', { ext: ext || '' }));
}
