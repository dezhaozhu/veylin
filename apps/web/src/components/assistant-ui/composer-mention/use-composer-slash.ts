import type { MentionTrigger } from './use-composer-mention';

/**
 * OpenHands-style slash word at cursor: `(^|\s)(/\S*)$` before cursor,
 * range extends through any trailing non-whitespace after cursor.
 */
export function detectSlashCommand(text: string, cursor: number): MentionTrigger | null {
  const normalized = text.replace(/[\n\r]+$/, '');
  const before = normalized.slice(0, cursor);
  const match = before.match(/(^|\s)(\/\S*)$/);
  if (!match) return null;

  const slashWord = match[2] ?? '';
  const query = slashWord.slice(1);
  const start = before.length - slashWord.length;
  const afterCursor = normalized.slice(cursor);
  const trailing = afterCursor.match(/^\S*/);
  const end = cursor + (trailing?.[0]?.length ?? 0);

  return { query, start, end };
}
