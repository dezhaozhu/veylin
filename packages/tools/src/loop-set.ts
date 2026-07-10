import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  LOOP_SET_TOOL,
  LOOP_WAKEUP_MIN_SECONDS,
  parseIntervalToSeconds,
  type ThreadLoopState,
} from '@veylin/shared';

export const loopSet = createTool({
  id: LOOP_SET_TOOL,
  description:
    'Start a recurring loop on this thread with a fixed interval. ' +
    'Call ONLY when both are clear from the conversation: (1) the recurring task prompt, ' +
    'and (2) the interval (intervalSeconds >= ' +
    `${LOOP_WAKEUP_MIN_SECONDS}, or interval like "5m" / "1h"). ` +
    'If the user armed Loop mode or asked for a loop but the task or interval is missing/ambiguous, ' +
    'do NOT call this yet — ask them first (prefer ask_user_question or a short clarifying question). ' +
    'Never invent an interval. After success, the loop is active; proceed with the first iteration.',
  inputSchema: z.object({
    prompt: z.string().min(1).describe('The recurring task to run each iteration.'),
    intervalSeconds: z
      .number()
      .optional()
      .describe(`Interval in seconds (minimum ${LOOP_WAKEUP_MIN_SECONDS}). Prefer this when known.`),
    interval: z
      .string()
      .optional()
      .describe('Interval string such as 5m, 1h, 30m. Used when intervalSeconds is omitted.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    message: z.string().optional(),
    loop: z
      .object({
        prompt: z.string(),
        mode: z.enum(['fixed', 'dynamic']),
        intervalSeconds: z.number().optional(),
        status: z.string(),
        jobId: z.string(),
      })
      .optional(),
  }),
  execute: async (input, ctx) => {
    const start = ctx?.requestContext?.get('startThreadLoop') as
      | ((args: {
          prompt: string;
          intervalSeconds?: number;
          interval?: string;
        }) => Promise<{
          ok: boolean;
          error?: string;
          message?: string;
          loop?: ThreadLoopState | null;
        }>)
      | undefined;

    let intervalSeconds = input.intervalSeconds;
    if (intervalSeconds == null && input.interval) {
      intervalSeconds = parseIntervalToSeconds(input.interval) ?? undefined;
    }
    if (intervalSeconds == null || intervalSeconds < LOOP_WAKEUP_MIN_SECONDS) {
      return {
        ok: false,
        error: 'interval_required',
        message: `Provide a clear interval of at least ${LOOP_WAKEUP_MIN_SECONDS}s (e.g. 5m → 300). Ask the user if needed.`,
      };
    }

    if (start) {
      const result = await start({
        prompt: input.prompt,
        intervalSeconds,
        interval: input.interval,
      });
      if (!result.ok || !result.loop) {
        return {
          ok: false,
          error: result.error ?? 'start_failed',
          message: result.message,
        };
      }
      return {
        ok: true,
        loop: {
          prompt: result.loop.prompt,
          mode: result.loop.mode,
          intervalSeconds: result.loop.intervalSeconds,
          status: result.loop.status,
          jobId: result.loop.jobId,
        },
      };
    }

    return { ok: false, error: 'unavailable', message: 'Loop start is not available in this context.' };
  },
});
