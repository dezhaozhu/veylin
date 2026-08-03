import TurndownService from 'turndown';
import { parseHTML } from 'linkedom';

let turndown: TurndownService | undefined;

function getTurndown(): TurndownService {
  if (!turndown) turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  return turndown;
}

export function htmlToMarkdown(html: string): string {
  try {
    const { document } = parseHTML(html);
    const root = document.body ?? document.documentElement;
    if (!root) return html;
    return getTurndown().turndown(root as unknown as Parameters<TurndownService['turndown']>[0]);
  } catch {
    return html;
  }
}

export function isBinaryContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('text/html') || ct.includes('text/plain') || ct.includes('text/markdown')) {
    return false;
  }
  if (ct.includes('application/json') || ct.includes('application/xml') || ct.includes('text/xml')) {
    return false;
  }
  if (ct.startsWith('image/') || ct.includes('application/pdf') || ct.includes('octet-stream')) {
    return true;
  }
  return false;
}
