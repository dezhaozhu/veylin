import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  LOOP_SCHEDULE_WAKEUP_TOOL,
  LOOP_WAKEUP_MIN_SECONDS,
  LOOP_WAKEUP_MAX_SECONDS,
  clampLoopWakeupSeconds,
  type ThreadLoopState,
} from '@veylin/shared';

export const loopScheduleWakeup = createTool({
  id: LOOP_SCHEDULE_WAKEUP_TOOL,
  description:
    `Schedule the next iteration of an active dynamic /loop, or stop the loop. ` +
    `Call at the end of a loop iteration with delaySeconds between ${LOOP_WAKEUP_MIN_SECONDS} and ${LOOP_WAKEUP_MAX_SECONDS}, or stop:true.`,
  inputSchema: z.object({
    delaySeconds: z
      .number()
      .optional()
      .describe(
        `Seconds until the next loop iteration (${LOOP_WAKEUP_MIN_SECONDS}–${LOOP_WAKEUP_MAX_SECONDS}). Ignored when stop is true.`,
      ),
    stop: z.boolean().optional().describe('Set true to end the loop.'),
    reason: z.string().optional().describe('Why this delay or stop was chosen.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    stopped: z.boolean().optional(),
    nextWakeAt: z.string().optional(),
    delaySeconds: z.number().optional(),
  }),
  execute: async (input, ctx) => {
    const schedule = ctx?.requestContext?.get('scheduleLoopWakeup') as
      | ((args: {
          delaySeconds?: number;
          stop?: boolean;
          reason?: string;
        }) => Promise<{
          ok: boolean;
          stopped?: boolean;
          nextWakeAt?: string;
          delaySeconds?: number;
        }>)
      | undefined;
    if (schedule) {
      return schedule({
        delaySeconds: input.delaySeconds,
        stop: input.stop,
        reason: input.reason,
      });
    }

    // Fallback: mutate in-memory loop via requestContext if present
    const loop = ctx?.requestContext?.get('threadLoop') as ThreadLoopState | null | undefined;
    const persist = ctx?.requestContext?.get('persistThreadLoop') as
      | ((loop: ThreadLoopState | null) => Promise<void>)
      | undefined;
    if (!loop || loop.status !== 'active') {
      return { ok: false };
    }
    if (input.stop) {
      const stopped = { ...loop, status: 'stopped' as const, nextWakeAt: undefined, stopRequested: true };
      if (persist) await persist(stopped);
      return { ok: true, stopped: true };
    }
    const delaySeconds = clampLoopWakeupSeconds(input.delaySeconds ?? 600);
    const nextWakeAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
    const next = { ...loop, nextWakeAt };
    if (persist) await persist(next);
    return { ok: true, nextWakeAt, delaySeconds };
  },
});
