import type { ThreadGoalState, ThreadLoopState } from '@veylin/shared';
import { LOOP_WAKEUP_MIN_SECONDS, LOOP_WAKEUP_MAX_SECONDS } from '@veylin/shared';

function reminder(text: string): string {
  return `<system-reminder>\n${text}\n</system-reminder>`;
}

export function buildGoalBlock(goal: ThreadGoalState | null | undefined): string {
  if (!goal || goal.status !== 'active') return '';
  const reason = goal.lastEvalReason?.trim();
  const lines = [
    'An active GOAL is set for this thread. Keep working until the completion condition is met.',
    `Condition: ${goal.condition}`,
    `Turns evaluated: ${goal.turnsEvaluated}/${goal.maxTurns}.`,
    'Leave concrete verification evidence in the conversation (command output, test results, file diffs).',
    'Do not claim the goal is complete yourself — an independent evaluator decides after each turn.',
  ];
  if (reason) {
    lines.push(`Previous evaluator reason (work on this next): ${reason}`);
  }
  return reminder(lines.join('\n'));
}

export function buildLoopBlock(loop: ThreadLoopState | null | undefined): string {
  if (!loop || loop.status !== 'active') return '';
  const cadence =
    loop.mode === 'fixed' && loop.intervalSeconds
      ? `fixed every ${loop.intervalSeconds}s`
      : 'dynamic (call loop_schedule_wakeup at the end of each iteration)';
  const lines = [
    'An active LOOP is set for this thread. This turn is one iteration of a recurring prompt.',
    `Prompt: ${loop.prompt}`,
    `Cadence: ${cadence}.`,
  ];
  if (loop.mode === 'dynamic') {
    lines.push(
      'Before finishing, call loop_schedule_wakeup with delaySeconds ' +
        `(${LOOP_WAKEUP_MIN_SECONDS}–${LOOP_WAKEUP_MAX_SECONDS}) or stop:true to end the loop.`,
    );
  }
  return reminder(lines.join('\n'));
}

/**
 * Agent-facing note appended to the last user turn when Loop mode is armed.
 * Not a system-reminder: the model should analyze completeness and ask or call loop_set.
 */
export function appendPendingLoopTurnNote<
  T extends { role: string; content: string | Array<{ type?: string; text?: string } | unknown> | unknown },
>(messages: T[]): T[] {
  if (messages.length === 0) return messages;
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) return messages;

  const note =
    '\n\n(Loop mode is armed. Analyze whether this request already has a complete recurring-loop spec: clear task + clear interval. If anything is missing or ambiguous, ask the user — do not invent an interval. When complete, call loop_set, then run the first iteration.)';

  const msg = messages[lastUser]!;
  const content = msg.content;
  if (typeof content === 'string') {
    const next = [...messages];
    next[lastUser] = { ...msg, content: content + note };
    return next;
  }
  if (Array.isArray(content)) {
    const next = [...messages];
    next[lastUser] = {
      ...msg,
      content: [...content, { type: 'text', text: note.trim() }],
    };
    return next;
  }
  return messages;
}

