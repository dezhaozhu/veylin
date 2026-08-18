import type { MentionTrigger } from './use-composer-mention';

/**
 * 命令**只在消息开头**存在:`^(/\S*)$` before cursor,range extends through any
 * trailing non-whitespace after cursor.
 *
 * 从前用的是 OpenHands 那条 `(^|\s)(/\S*)$` —— 任何空格后面的 `/` 都算。写一句
 * 「文件都在 /Users/…/example_files/」就会弹出"没有匹配的技能或命令",而句中的
 * 斜杠**永远**是内容:路径、分数、日期、and/or。Claude 也是这么定的:开头才是命令。
 */
export function detectSlashCommand(text: string, cursor: number): MentionTrigger | null {
  const normalized = text.replace(/[\n\r]+$/, '');
  const before = normalized.slice(0, cursor);
  const match = before.match(/^(\/\S*)$/);
  if (!match) return null;

  const slashWord = match[1] ?? '';
  const query = slashWord.slice(1);
  const start = before.length - slashWord.length;
  const afterCursor = normalized.slice(cursor);
  const trailing = afterCursor.match(/^\S*/);
  const end = cursor + (trailing?.[0]?.length ?? 0);

  return { query, start, end };
}
