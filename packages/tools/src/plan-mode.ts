import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ENTER_PLAN_MODE_TOOL, EXIT_PLAN_MODE_TOOL } from '@veylin/shared';

/** Thread-scoped plan mode flag (the agent EnterPlanModeTool / ExitPlanModeTool). */
const planModeByThread = new Map<string, boolean>();

export function getThreadPlanMode(threadId: string): boolean {
  return planModeByThread.get(threadId) ?? false;
}

export function setThreadPlanMode(threadId: string, on: boolean): void {
  planModeByThread.set(threadId, on);
}

export const enterPlanMode = createTool({
  id: ENTER_PLAN_MODE_TOOL,
  description:
    'Enter planning mode: a read-only phase for exploring and designing an approach before ' +
    'making any changes. While in plan mode, mutating tools are denied, so use this when a task ' +
    'is large, ambiguous, or has meaningful trade-offs and you want to investigate and present a ' +
    'plan first. Call exit_plan_mode once the plan is ready and you are cleared to execute.',
  inputSchema: z.object({
    reason: z.string().optional().describe('Why planning mode is needed'),
  }),
  outputSchema: z.object({ planMode: z.literal(true) }),
  execute: async (_input, ctx) => {
    const setter = ctx?.requestContext?.get('setPlanMode') as ((on: boolean) => Promise<void>) | undefined;
    if (setter) await setter(true);
    else {
      const threadId = ctx?.requestContext?.get('threadId') as string | undefined;
      if (threadId) setThreadPlanMode(threadId, true);
    }
    ctx?.requestContext?.set('planMode', true);
    return { planMode: true as const };
  },
});

export const exitPlanMode = createTool({
  id: EXIT_PLAN_MODE_TOOL,
  description:
    'Exit planning mode and proceed with execution. Call this only after you have explored ' +
    'enough and are ready to act; it re-enables mutating tools (subject to the usual approval ' +
    'gates).',
  inputSchema: z.object({}),
  outputSchema: z.object({ planMode: z.literal(false) }),
  execute: async (_input, ctx) => {
    const setter = ctx?.requestContext?.get('setPlanMode') as ((on: boolean) => Promise<void>) | undefined;
    if (setter) await setter(false);
    else {
      const threadId = ctx?.requestContext?.get('threadId') as string | undefined;
      if (threadId) setThreadPlanMode(threadId, false);
    }
    ctx?.requestContext?.set('planMode', false);
    return { planMode: false as const };
  },
});
