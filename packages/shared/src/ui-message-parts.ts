/** Obsolete or mis-parsed tool part types dropped on load/persist. */
const OBSOLETE_UI_PART_TYPES = new Set(['tool-invocation']);
const MISPARSED_TOOL_SUFFIXES = new Set(['invocation', 'call']);

const ASK_USER_CONTINUATION_RE =
  /User has answered your questions:[\s\S]*?You can now continue with the user's answers in mind\.?/gi;

/** Model-only continuation copy from answered ask_user_question (not for chat UI). */
export function stripInternalModelContinuationText(text: string): string {
  return text
    .replace(ASK_USER_CONTINUATION_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isInternalModelContinuationText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return stripInternalModelContinuationText(trimmed).length === 0;
}

/** Drop or trim text parts that only exist for the model continuation path. */
export function sanitizeDisplayTextPart(text: string): string | null {
  const cleaned = stripInternalModelContinuationText(text);
  return cleaned.length > 0 ? cleaned : null;
}

export function sanitizeUiMessagePartsForDisplay<T extends { type?: string; text?: string }>(
  parts: T[] | undefined,
): T[] {
  if (!parts) return [];
  const out: T[] = [];
  for (const part of parts) {
    if (isObsoleteUiMessagePart(part)) continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      const cleaned = sanitizeDisplayTextPart(part.text);
      if (cleaned === null) continue;
      out.push(cleaned === part.text ? part : ({ ...part, text: cleaned } as T));
      continue;
    }
    out.push(part);
  }
  return out;
}

export function isObsoleteUiMessagePart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false;
  const type = (part as { type?: string }).type;
  if (!type) return false;
  if (OBSOLETE_UI_PART_TYPES.has(type)) return true;
  if (type.startsWith('tool-')) {
    const name = type.slice('tool-'.length);
    if (MISPARSED_TOOL_SUFFIXES.has(name)) return true;
  }
  return false;
}

export function filterPersistableUiMessageParts<T extends { type?: string; text?: string }>(
  parts: T[] | undefined,
): T[] {
  if (!parts) return [];
  const out: T[] = [];
  for (const part of parts) {
    if (isObsoleteUiMessagePart(part)) continue;
    if (part.type === 'step-start') {
      out.push(part);
      continue;
    }
    if (part.type?.startsWith('data-veylin-')) {
      out.push(part);
      continue;
    }
    if (part.type === 'text' && typeof part.text === 'string') {
      const cleaned = sanitizeDisplayTextPart(part.text);
      if (cleaned === null) continue;
      out.push(cleaned === part.text ? part : ({ ...part, text: cleaned } as T));
      continue;
    }
    out.push(part);
  }
  return out;
}

export type SanitizableUiPart = { type?: string; text?: string };

export function coerceSanitizableUiParts(parts: unknown[] | undefined): SanitizableUiPart[] {
  if (!parts) return [];
  return parts.filter((part): part is SanitizableUiPart => Boolean(part) && typeof part === 'object');
}
