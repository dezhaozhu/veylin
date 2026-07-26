import type {
  PersistedAssistantTurnTiming,
  WorkSegment,
} from '@veylin/shared';

export type AssistantTurnTiming = PersistedAssistantTurnTiming;

export type AssistantTimingEvent =
  | { type: 'running' | 'resumed'; runId: string; now: number }
  | { type: 'suspended' | 'finished' | 'failed'; now: number };

function closeWorkSegment(
  timing: AssistantTurnTiming,
  now: number,
): AssistantTurnTiming {
  const open = timing.openSegment;
  if (!open || open.kind !== 'work') return timing;
  const endedAt = Math.max(open.startedAt, now);
  const durationMs = endedAt - open.startedAt;
  const segment: WorkSegment = {
    ...open,
    endedAt,
    durationMs,
  };
  return {
    ...timing,
    accumulatedWorkMs: timing.accumulatedWorkMs + durationMs,
    segments: [...timing.segments, segment],
    openSegment: undefined,
  };
}

export function createAssistantTurnTiming(
  runId: string,
): AssistantTurnTiming {
  return {
    runId,
    phase: 'idle',
    accumulatedWorkMs: 0,
    segments: [],
  };
}

/**
 * Accumulates only active model/tool execution. A suspended interval is closed
 * immediately and the user's think time is therefore never charged.
 */
export function reduceAssistantTurnTiming(
  timing: AssistantTurnTiming,
  event: AssistantTimingEvent,
): AssistantTurnTiming {
  if (event.type === 'running' || event.type === 'resumed') {
    if (timing.phase === 'working' && timing.openSegment) return timing;
    return {
      ...timing,
      runId: event.runId,
      phase: 'working',
      openSegment: {
        key: `${event.runId}:work:${timing.segments.length}`,
        kind: 'work',
        startedAt: event.now,
      },
    };
  }

  const closed = closeWorkSegment(timing, event.now);
  return {
    ...closed,
    phase:
      event.type === 'suspended'
        ? 'waiting_user'
        : event.type === 'failed'
          ? 'failed'
          : 'finished',
  };
}

export function assistantTurnWorkMs(
  timing: AssistantTurnTiming | undefined,
  now = Date.now(),
): number | undefined {
  if (!timing) return undefined;
  const live =
    timing.phase === 'working' && timing.openSegment?.kind === 'work'
      ? Math.max(0, now - timing.openSegment.startedAt)
      : 0;
  return timing.accumulatedWorkMs + live;
}

export function reasoningSegmentKey(
  parts: readonly { type?: string }[],
  index: number,
  runId: string,
): string {
  let stepIndex = 0;
  for (let i = 0; i <= index; i += 1) {
    if (parts[i]?.type === 'step-start') stepIndex += 1;
  }
  return `${runId}:reasoning:${stepIndex}:${index}`;
}

export function reasoningSegmentDurationMs(
  timing: AssistantTurnTiming | undefined,
  parts: readonly { type?: string }[],
  index: number,
): number | undefined {
  if (!timing) return undefined;
  const suffix = reasoningSegmentKey(parts, index, '').slice(1);
  const duration = timing.segments
    .filter((segment) => segment.kind === 'reasoning' && segment.key.endsWith(suffix))
    .reduce((sum, segment) => sum + segment.durationMs, 0);
  return duration > 0 ? duration : undefined;
}

