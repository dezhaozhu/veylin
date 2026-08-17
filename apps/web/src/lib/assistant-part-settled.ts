export type SettleablePart = {
  type?: string;
  data?: unknown;
  toolCallId?: string;
  toolName?: string;
  status?: { type?: string };
  result?: unknown;
  isError?: boolean;
  state?: string;
};

export type AssistantRunPhase =
  | 'idle'
  | 'working'
  | 'waiting_user'
  | 'finished'
  | 'failed';

/**
 * Effective phase used for folding and footer visibility.
 * Non-last messages normalize stuck in-progress phases to finished so history
 * keeps its completed Worked-for shell after a new turn starts.
 */
export function resolveAssistantRunPhase(options: {
  recordedPhase?: AssistantRunPhase | null;
  isLastMessage: boolean;
  threadIsRunning: boolean;
}): AssistantRunPhase {
  const { recordedPhase, isLastMessage, threadIsRunning } = options;
  if (!isLastMessage) {
    return recordedPhase === 'failed' ? 'failed' : 'finished';
  }
  return recordedPhase ?? (threadIsRunning ? 'working' : 'finished');
}

/** Copy + timestamp footer only after the turn truly ends. */
export function shouldShowAssistantFooter(phase: AssistantRunPhase): boolean {
  return phase === 'finished' || phase === 'failed';
}

/**
 * Whether to wrap pre-final work in the Worked-for shell.
 * Finished turns gate on content; in-progress turns gate on a completed prefix.
 */
export function shouldFoldAssistantWork(options: {
  phase: AssistantRunPhase;
  foldedPrefixEnd: number;
  hasPreFinalWork: boolean;
}): boolean {
  const { phase, foldedPrefixEnd, hasPreFinalWork } = options;
  if (phase === 'finished' || phase === 'failed') {
    return hasPreFinalWork;
  }
  return foldedPrefixEnd > 0;
}

function stepStartAtOrBefore(
  parts: readonly SettleablePart[],
  index: number,
): number {
  for (let i = index; i >= 0; i -= 1) {
    if (parts[i]?.type === 'step-start') return i;
  }
  return Math.max(0, index);
}

/**
 * Exclusive boundary for the already-completed prefix that may be folded.
 * The current native-suspended step always remains outside the fold.
 */
export function findFoldedPrefixEnd(
  parts: readonly SettleablePart[],
  phase: AssistantRunPhase,
): number {
  if (phase === 'finished' || phase === 'failed') return parts.length;

  if (phase === 'waiting_user') {
    let suspendedToolCallId: string | undefined;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const part = parts[i];
      if (part?.type !== 'data-tool-call-suspended') continue;
      suspendedToolCallId =
        part.data && typeof part.data === 'object'
          ? (part.data as { toolCallId?: string }).toolCallId
          : undefined;
      if (suspendedToolCallId) break;
    }
    if (suspendedToolCallId) {
      const toolIndex = parts.findIndex(
        (part) => part.toolCallId === suspendedToolCallId,
      );
      if (toolIndex >= 0) return stepStartAtOrBefore(parts, toolIndex);
    }
    return 0;
  }

  if (phase === 'working') {
    for (let i = parts.length - 1; i > 0; i -= 1) {
      if (parts[i]?.type === 'step-start') return i;
    }
  }
  return 0;
}

/**
 * Index of the trailing part that must stay outside the fold when a turn has no
 * final prose (e.g. it ended on a tool error), so the message never collapses
 * into a bare "Worked for" label. Returns -1 when there is nothing to show.
 */
export function findTrailingVisiblePartIndex(
  parts: readonly SettleablePart[],
): number {
  for (let i = parts.length - 1; i >= 0; i--) {
    const type = parts[i]?.type;
    if (!type || type === 'step-start') continue;
    return i;
  }
  return -1;
}
