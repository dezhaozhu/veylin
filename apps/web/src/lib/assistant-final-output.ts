import { isTaskNotificationText } from '@veylin/shared';

export type AssistantPartLike = {
  type?: string;
  text?: string;
  toolName?: string;
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
 * A finished native run has one unambiguous visible result: its last
 * substantial text. Tool suspensions are lifecycle events, not prose markers.
 */
export function findFinalProseIndex(parts: readonly AssistantPartLike[]): number {
  return findLastSubstantialTextIndex(parts);
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
