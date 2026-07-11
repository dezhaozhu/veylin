import { isTaskNotificationText } from '@veylin/shared';

export type AssistantPartLike = {
  type?: string;
  text?: string;
};

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

/**
 * True when anything before the final text should be folded under Worked for
 * (reasoning, tools, or earlier prose).
 */
export function hasPreFinalWork(
  parts: readonly AssistantPartLike[],
  lastTextIndex = findLastSubstantialTextIndex(parts),
): boolean {
  if (lastTextIndex < 0) {
    return parts.some((p) => p.type === 'reasoning' || p.type === 'tool-call');
  }
  for (let i = 0; i < lastTextIndex; i++) {
    const type = parts[i]?.type;
    if (type === 'reasoning' || type === 'tool-call' || type === 'text') {
      if (type === 'text' && !isSubstantialTextPart(parts[i])) continue;
      return true;
    }
  }
  return false;
}
