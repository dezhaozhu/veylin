/** Obsolete or mis-parsed tool part types dropped on load/persist. */
import { isTaskNotificationText } from './task-notification.js';
import { migrateLegacyToolPart } from './assistant-display-parts.js';

const OBSOLETE_UI_PART_TYPES = new Set<string>();
const MISPARSED_TOOL_SUFFIXES = new Set(['call']);

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

/** Server-injected subagent results — model context only, not chat UI. */
export function isModelInjectedUserText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return isInternalModelContinuationText(trimmed) || isTaskNotificationText(trimmed);
}

/** Drop or trim text parts that only exist for the model continuation path. */
export function sanitizeDisplayTextPart(text: string): string | null {
  if (isModelInjectedUserText(text)) return null;
  const cleaned = stripInternalModelContinuationText(text);
  return cleaned.length > 0 ? cleaned : null;
}

/** Agent context recall — keep task notifications, drop ask-user continuation boilerplate. */
export function sanitizeAgentContextTextPart(text: string): string | null {
  if (isInternalModelContinuationText(text)) return null;
  const cleaned = stripInternalModelContinuationText(text);
  return cleaned.length > 0 ? cleaned : null;
}

export function sanitizeUiMessagePartsForDisplay<T extends { type?: string; text?: string }>(
  parts: T[] | undefined,
): T[] {
  if (!parts) return [];
  const out: T[] = [];
  for (const part of parts) {
    const migrated = migrateLegacyToolPart(part) as T;
    if (isObsoleteUiMessagePart(migrated)) continue;
    if (migrated.type === 'text' && typeof migrated.text === 'string') {
      const cleaned = sanitizeDisplayTextPart(migrated.text);
      if (cleaned === null) continue;
      out.push(cleaned === migrated.text ? migrated : ({ ...migrated, text: cleaned } as T));
      continue;
    }
    out.push(migrated);
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

type ReasoningPersistPart = {
  type?: string;
  text?: string;
  details?: unknown;
};

/** AI SDK core conversion requires iterable reasoning.details when persisting to Mastra memory. */
export function normalizeReasoningPartForPersistence<T extends ReasoningPersistPart>(part: T): T {
  if (part.type !== 'reasoning') return part;
  if (Array.isArray(part.details)) return part;
  const text = typeof part.text === 'string' ? part.text : '';
  return {
    ...part,
    details: text ? [{ type: 'text', text }] : [],
  } as T;
}

export function filterPersistableUiMessageParts<T extends { type?: string; text?: string }>(
  parts: T[] | undefined,
): T[] {
  if (!parts) return [];
  const out: T[] = [];
  for (const part of parts) {
    const migrated = migrateLegacyToolPart(part) as T;
    if (isObsoleteUiMessagePart(migrated)) continue;
    if (migrated.type === 'step-start') {
      out.push(migrated);
      continue;
    }
    if (migrated.type?.startsWith('data-veylin-')) {
      out.push(migrated);
      continue;
    }
    if (migrated.type === 'text' && typeof migrated.text === 'string') {
      const cleaned = sanitizeDisplayTextPart(migrated.text);
      if (cleaned === null) continue;
      out.push(cleaned === migrated.text ? migrated : ({ ...migrated, text: cleaned } as T));
      continue;
    }
    if (migrated.type === 'reasoning') {
      out.push(normalizeReasoningPartForPersistence(migrated));
      continue;
    }
    out.push(migrated);
  }
  return out;
}

export function filterAgentContextUiMessageParts<T extends { type?: string; text?: string }>(
  parts: T[] | undefined,
): T[] {
  if (!parts) return [];
  const out: T[] = [];
  for (const part of parts) {
    const migrated = migrateLegacyToolPart(part) as T;
    if (isObsoleteUiMessagePart(migrated)) continue;
    if (migrated.type === 'step-start') {
      out.push(migrated);
      continue;
    }
    if (migrated.type?.startsWith('data-veylin-')) {
      out.push(migrated);
      continue;
    }
    if (migrated.type === 'text' && typeof migrated.text === 'string') {
      const cleaned = sanitizeAgentContextTextPart(migrated.text);
      if (cleaned === null) continue;
      out.push(cleaned === migrated.text ? migrated : ({ ...migrated, text: cleaned } as T));
      continue;
    }
    if (migrated.type === 'reasoning') {
      out.push(normalizeReasoningPartForPersistence(migrated));
      continue;
    }
    out.push(migrated);
  }
  return out;
}

export type SanitizableUiPart = { type?: string; text?: string };

export function coerceSanitizableUiParts(parts: unknown[] | undefined): SanitizableUiPart[] {
  if (!parts) return [];
  return parts.filter((part): part is SanitizableUiPart => Boolean(part) && typeof part === 'object');
}
