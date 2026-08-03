import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

export const LINE_FORMAT_INSTRUCTION =
  'Line numbers are formatted as "   1|content" (4-char padded number + pipe).';

export interface DocumentStat {
  kind: 'text' | 'image' | 'pdf' | 'binary';
  mediaType?: string;
  bytes?: number;
  /** Last-modified time in ms since epoch (used for read/write freshness checks). */
  mtimeMs?: number;
}

export interface DocumentReadResult {
  content: string;
  totalLines: number;
  lineFormat: typeof LINE_FORMAT_INSTRUCTION;
}

export interface DocumentProvider {
  readText(path: string, opts?: { offset?: number; limit?: number }): Promise<DocumentReadResult>;
  stat(path: string): Promise<DocumentStat>;
  readPdfText?(path: string): Promise<string | null>;
}

function formatLineNumber(n: number): string {
  return String(n).padStart(4, ' ');
}

function withLineNumbers(lines: string[], startLine: number): string {
  return lines.map((line, i) => `${formatLineNumber(startLine + i)}|${line}`).join('\n');
}

const IMAGE_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  return i >= 0 ? p.slice(i).toLowerCase() : '';
}

/** Default provider backed by the local filesystem. */
export class LocalFileProvider implements DocumentProvider {
  async stat(path: string): Promise<DocumentStat> {
    const target = resolve(path);
    const ext = extOf(target);
    if (ext === '.pdf') {
      const s = await fs.stat(target);
      return { kind: 'pdf', mediaType: 'application/pdf', bytes: s.size, mtimeMs: s.mtimeMs };
    }
    if (IMAGE_EXT[ext]) {
      const s = await fs.stat(target);
      return { kind: 'image', mediaType: IMAGE_EXT[ext], bytes: s.size, mtimeMs: s.mtimeMs };
    }
    try {
      const s = await fs.stat(target);
      return { kind: 'text', bytes: s.size, mtimeMs: s.mtimeMs };
    } catch {
      return { kind: 'binary' };
    }
  }

  async readText(path: string, opts?: { offset?: number; limit?: number }): Promise<DocumentReadResult> {
    const target = resolve(path);
    const raw = await fs.readFile(target, 'utf8');
    const allLines = raw.split('\n');
    const start = (opts?.offset ?? 1) - 1;
    const end = opts?.limit ? start + opts.limit : allLines.length;
    const slice = allLines.slice(start, end);
    return {
      content: withLineNumbers(slice, start + 1),
      totalLines: allLines.length,
      lineFormat: LINE_FORMAT_INSTRUCTION,
    };
  }

  async readPdfText(path: string): Promise<string | null> {
    try {
      const target = resolve(path);
      const bytes = await fs.readFile(target);
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      const body = (Array.isArray(text) ? text.join('\n') : text).trim();
      return body || null;
    } catch {
      return null;
    }
  }
}

export const defaultDocumentProvider = new LocalFileProvider();
