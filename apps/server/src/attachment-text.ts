/** AI SDK / Mastra text part produced from an uploaded text-like attachment. */
export type TextContentPart = { type: 'text'; text: string };

const LINE_FORMAT =
  'Line numbers are formatted as "   1|content" (4-char padded number + pipe).';

const TEXT_MAX_LINES = Number(process.env.VEYLIN_ATTACHMENT_TEXT_MAX_LINES ?? 2000);
const TEXT_MAX_BYTES = Number(process.env.VEYLIN_ATTACHMENT_TEXT_MAX_BYTES ?? 512_000);

/** Extensions the agent treats as binary for Read (not inlineable as UTF-8 text). */
const BINARY_EXTENSIONS = new Set([
  '.zip',
  '.gz',
  '.tar',
  '.rar',
  '.7z',
  '.bz2',
  '.xz',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.wasm',
  '.o',
  '.a',
  '.lib',
  '.dmg',
  '.iso',
  '.deb',
  '.rpm',
  '.msi',
  '.apk',
  '.ipa',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.ico',
  '.heic',
  '.heif',
  '.avif',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.wav',
  '.flac',
]);

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.jsonc',
  '.json5',
  '.yaml',
  '.yml',
  '.xml',
  '.csv',
  '.tsv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.astro',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.cs',
  '.cpp',
  '.cc',
  '.cxx',
  '.c',
  '.h',
  '.hpp',
  '.swift',
  '.php',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.svg',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.log',
  '.graphql',
  '.gql',
  '.proto',
  '.dockerfile',
  '.ipynb',
  '.tex',
  '.rst',
  '.adoc',
]);

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i).toLowerCase() : '';
}

function basename(filename: string): string {
  const i = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  return i >= 0 ? filename.slice(i + 1) : filename;
}

function formatLineNumber(n: number): string {
  return String(n).padStart(4, ' ');
}

function withLineNumbers(lines: string[], startLine: number): string {
  return lines.map((line, i) => `${formatLineNumber(startLine + i)}|${line}`).join('\n');
}

export function isBinaryAttachment(filename: string, mediaType: string): boolean {
  const ext = extOf(filename);
  if (TEXT_EXTENSIONS.has(ext)) return false;
  if (mediaType === 'application/pdf' || ext === '.pdf') return false;
  if (BINARY_EXTENSIONS.has(ext)) return true;
  if (mediaType.startsWith('image/') && mediaType !== 'image/svg+xml') return true;
  if (mediaType.startsWith('audio/') || mediaType.startsWith('video/')) return true;
  if (
    mediaType.includes('zip') ||
    mediaType.includes('octet-stream') ||
    mediaType.includes('msword') ||
    mediaType.includes('spreadsheet') ||
    mediaType.includes('presentation')
  ) {
    return true;
  }
  return false;
}

/** Whether an uploaded attachment should be decoded and inlined as UTF-8 text. */
export function isTextLikeAttachment(filename: string, mediaType: string): boolean {
  if (isBinaryAttachment(filename, mediaType)) return false;
  const ext = extOf(filename);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (mediaType.startsWith('text/')) return true;
  if (
    mediaType === 'application/json' ||
    mediaType === 'application/xml' ||
    mediaType === 'application/javascript' ||
    mediaType === 'application/x-yaml' ||
    mediaType === 'application/yaml' ||
    mediaType === 'application/toml' ||
    mediaType === 'application/sql' ||
    mediaType === 'image/svg+xml'
  ) {
    return true;
  }
  // Extensionless env files, Dockerfile, etc.
  const base = basename(filename).toLowerCase();
  if (base === 'dockerfile' || base === 'makefile' || base.startsWith('.env')) return true;
  return false;
}

export function decodeDataUrlToUtf8(url: string): string | null {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) return null;
  const payload = url.slice(comma + 1);
  const meta = url.slice(5, comma);
  try {
    if (meta.includes(';base64')) {
      const buf = Buffer.from(payload, 'base64');
      if (buf.length > TEXT_MAX_BYTES) return null;
      const text = buf.toString('utf8');
      if (text.includes('\uFFFD') && !meta.includes('charset')) {
        // Likely not UTF-8 text.
        return null;
      }
      return text;
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

/**
 * Inline a text-like attachment the way the agent's Read tool surfaces files:
 * agent-style line numbers, truncation for very large files, and a header
 * naming the attachment.
 */
export function textAttachmentToPart(filename: string, raw: string): TextContentPart {
  const name = filename || 'attachment.txt';
  const lines = raw.split('\n');
  const totalLines = lines.length;
  const truncatedByLines = totalLines > TEXT_MAX_LINES;
  const slice = truncatedByLines ? lines.slice(0, TEXT_MAX_LINES) : lines;
  const body = withLineNumbers(slice, 1);
  const header = truncatedByLines
    ? `[Attached file "${name}", ${totalLines} line(s); showing first ${TEXT_MAX_LINES}. ${LINE_FORMAT}]`
    : `[Attached file "${name}", ${totalLines} line(s). ${LINE_FORMAT}]`;
  return { type: 'text', text: `${header}\n${body}` };
}

export function unsupportedAttachmentPart(filename: string, mediaType: string): TextContentPart {
  const name = filename || 'attachment';
  const ext = extOf(name);
  return {
    type: 'text',
    text:
      `[Attached file "${name}" (${mediaType || 'unknown type'}) cannot be read as text. ` +
      (ext
        ? `Binary or unsupported format (${ext}). Convert to PDF or plain text (.md, .txt, .json) and re-attach.`
        : 'Convert to PDF or plain text (.md, .txt, .json) and re-attach.'),
  };
}
