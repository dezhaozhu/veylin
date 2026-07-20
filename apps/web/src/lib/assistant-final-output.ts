import { isTaskNotificationText } from '@veylin/shared';

export type AssistantPartLike = {
  type?: string;
  text?: string;
};

const FRONTEND_SUSPEND_TOOL_TYPES = new Set([
  'tool-ask_user_question',
  'tool-read_open_page',
]);

/** True when a text part has user-visible content (not empty / task noise). */
export function isSubstantialTextPart(part: AssistantPartLike | undefined): boolean {
  if (!part || part.type !== 'text') return false;
  const text = typeof part.text === 'string' ? part.text.trim() : '';
  if (!text) return false;
  if (isTaskNotificationText(text)) return false;
  return true;
}

/**
 * Index of the last substantial text part — the "final output" that stays
 * visible outside the Worked-for collapse. Returns -1 when none exist.
 */
export function findLastSubstantialTextIndex(
  parts: readonly AssistantPartLike[],
): number {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (isSubstantialTextPart(parts[i])) return i;
  }
  return -1;
}

/** Last ask_user_question / read_open_page part index, or -1. */
export function findLastFrontendSuspendToolIndex(
  parts: readonly AssistantPartLike[],
): number {
  for (let i = parts.length - 1; i >= 0; i--) {
    const type = parts[i]?.type;
    if (typeof type === 'string' && FRONTEND_SUSPEND_TOOL_TYPES.has(type)) {
      return i;
    }
  }
  return -1;
}

/**
 * Index of the final prose part kept outside Worked-for:
 * - with a frontend-suspend tool: last substantial text *after* that tool
 * - without: last substantial text overall
 */
export function findFinalProseIndex(parts: readonly AssistantPartLike[]): number {
  const suspendIdx = findLastFrontendSuspendToolIndex(parts);
  const from = suspendIdx >= 0 ? suspendIdx + 1 : 0;
  for (let i = parts.length - 1; i >= from; i--) {
    if (isSubstantialTextPart(parts[i])) return i;
  }
  return -1;
}

/** Whether this part index is the final prose kept outside Worked-for. */
export function isFinalProsePart(
  parts: readonly AssistantPartLike[],
  index: number,
  finalProseIndex = findFinalProseIndex(parts),
): boolean {
  if (finalProseIndex < 0 || index !== finalProseIndex) return false;
  return isSubstantialTextPart(parts[index]);
}

/**
 * True when anything besides visible prose should be folded under Worked for
 * (reasoning or tools). Final prose stays outside the shell.
 */
export function hasPreFinalWork(
  parts: readonly AssistantPartLike[],
  lastTextIndex = findFinalProseIndex(parts),
): boolean {
  if (lastTextIndex < 0) {
    return parts.some(
      (p) =>
        p.type === 'reasoning' ||
        p.type === 'tool-call' ||
        p.type === 'step-start' ||
        (typeof p.type === 'string' && p.type.startsWith('tool-')),
    );
  }
  for (let i = 0; i < parts.length; i++) {
    if (i === lastTextIndex) continue;
    const type = parts[i]?.type;
    if (type === 'reasoning' || type === 'tool-call' || type === 'step-start') {
      return true;
    }
    if (typeof type === 'string' && type.startsWith('tool-')) {
      return true;
    }
    // Earlier substantial text is pre-final work (fold it).
    if (isSubstantialTextPart(parts[i])) {
      return true;
    }
  }
  return false;
}
