import { createTool } from '@mastra/core/tools';
import { RequestContext } from '@mastra/core/di';
import { z } from 'zod';
import { insertTask, updateTaskRow } from '@veylin/db';
import type { QueuePort } from './queue';
import {
  SUBAGENT_PRESETS,
  SUBAGENT_TYPES,
  subagentAgentId,
  type Runtime,
  type SubagentPreset,
} from '@veylin/runtime';
import { SUBAGENT_QUEUE, type SubagentJob } from './queue';

const DEV_TENANT_FALLBACK = '00000000-0000-0000-0000-000000000000';

/** Read-only schedule tools exposed to non-mutating presets. */
const READ_ONLY_SCHEDULE_TOOLS = ['schedule_get', 'schedule_list_sheets'];

interface SubagentCtx {
  requestContext?: { get(key: string): unknown; set?(key: string, value: unknown): void };
  abortSignal?: AbortSignal;
}

export interface SubagentToolDeps {
  boss: QueuePort;
  /** MCP toolsets keyed by server name. */
  mcpToolsets: Record<string, unknown>;
  /** The full schedule toolset (record of tool id -> tool). */
  scheduleTools: Record<string, unknown>;
}

function ctxValue(ctx: SubagentCtx | undefined, key: string): string | undefined {
  return ctx?.requestContext?.get(key) as string | undefined;
}

/**
 * Wrap the caller's prompt in a task envelope so the subagent knows it is a
 * delegated, bounded run: it works autonomously, returns a structured summary,
 * and cannot ask the user questions or spawn further subagents.
 */
function subagentTaskEnvelope(preset: SubagentPreset, prompt: string): string {
  return [
    `You are the "${preset.key}" subagent dispatched by a parent agent to handle one scoped task.`,
    '',
    'Operating rules:',
    '- Work autonomously and complete the task end to end with the tools available to you.',
    '- You CANNOT ask the user questions; if something is ambiguous, state your assumption and proceed.',
    '- You CANNOT dispatch further subagents.',
    '- Stay within the scope of the task below; do not take unrelated actions.',
    '- When done, return a concise, structured summary of what you found or changed, with concrete',
    '  references (file paths + line numbers, sheet/row ids, commands run) the parent can act on.',
    '',
    'Task:',
    prompt,
  ].join('\n');
}

/** Build the trimmed toolsets a given preset is allowed to use. */
function toolsetsForPreset(
  preset: SubagentPreset,
  deps: SubagentToolDeps,
): Record<string, unknown> {
  const toolsets: Record<string, unknown> = {};

  if (preset.scheduleMode === 'full') {
    toolsets.schedule = deps.scheduleTools;
  } else if (preset.scheduleMode === 'read') {
    toolsets.schedule = Object.fromEntries(
      Object.entries(deps.scheduleTools).filter(([id]) => READ_ONLY_SCHEDULE_TOOLS.includes(id)),
    );
  }

  for (const server of preset.includeMcp) {
    if (deps.mcpToolsets[server]) toolsets[server] = deps.mcpToolsets[server];
  }

  return toolsets;
}

/**
 * Claude-Code-style `task` tool: dispatch a built-in preset subagent.
 * Synchronous by default (runs inline and returns a summary); optionally
 * backgrounded via the in-process task queue.
 */
export function buildSubagentTool(runtime: Runtime, deps: SubagentToolDeps) {
  const task = createTool({
    id: 'task',
    description:
      'Dispatch a specialized subagent to handle a scoped task and return its summary. ' +
      'Pick subagent_type by need: ' +
      Object.values(SUBAGENT_PRESETS)
        .map((p) => `"${p.key}" (${p.description})`)
        .join('; ') +
      '. Set run_in_background to queue a long task and get a taskId instead of an inline result.',
    inputSchema: z.object({
      subagent_type: z.enum(SUBAGENT_TYPES as [string, ...string[]]).describe('Preset subagent to run.'),
      prompt: z.string().describe('Self-contained instruction for the subagent.'),
      run_in_background: z
        .boolean()
        .optional()
        .describe('Queue the task in the background and return a taskId instead of waiting.'),
    }),
    outputSchema: z.object({
      subagent_type: z.string(),
      summary: z.string().nullable(),
      taskId: z.string().nullable(),
      background: z.boolean(),
    }),
    execute: async (input, ctx?: SubagentCtx) => {
      const preset = SUBAGENT_PRESETS[input.subagent_type];
      if (!preset) {
        return {
          subagent_type: input.subagent_type,
          summary: `Unknown subagent type: ${input.subagent_type}`,
          taskId: null,
          background: false,
        };
      }

      // Recursion guard: subagents must not dispatch further subagents.
      if (ctx?.requestContext?.get('subagentActive') === true) {
        return {
          subagent_type: input.subagent_type,
          summary: 'A subagent cannot dispatch further subagents.',
          taskId: null,
          background: false,
        };
      }

      const tenantId = ctxValue(ctx, 'tenantId') ?? DEV_TENANT_FALLBACK;
      const userId = ctxValue(ctx, 'userId') ?? tenantId;
      const parentThreadId = ctxValue(ctx, 'threadId');
      const model = ctxValue(ctx, 'model');
      const agentId = subagentAgentId(preset.key);
      const envelopedPrompt = subagentTaskEnvelope(preset, input.prompt);

      // Background dispatch: reuse the in-process queue path.
      if (input.run_in_background === true) {
        const row = await insertTask({
          tenantId,
          parentThreadId: parentThreadId ?? null,
          agentId,
          prompt: envelopedPrompt,
          label: `subagent:${preset.key}`,
          status: 'queued',
        });
        const taskId = row.id;
        const job: SubagentJob = {
          tenantId,
          threadId: `task-${taskId}`,
          agentId,
          prompt: envelopedPrompt,
          parentThreadId,
          parentResource: userId,
          label: `subagent:${preset.key}`,
          taskId,
        };
        const jobId = await deps.boss.send(SUBAGENT_QUEUE, job);
        await updateTaskRow(taskId, { jobId: jobId ?? null });
        return { subagent_type: preset.key, summary: null, taskId, background: true };
      }

      // Synchronous dispatch: run inline, isolated memory thread, scoped toolsets.
      const agent = runtime.getAgent(agentId);
      if (!agent) {
        return {
          subagent_type: preset.key,
          summary: `Subagent not registered: ${agentId}`,
          taskId: null,
          background: false,
        };
      }

      const subCtx = new RequestContext();
      subCtx.set('tenantId', tenantId);
      subCtx.set('userId', userId);
      subCtx.set('planMode', false);
      subCtx.set('discoveredToolIds', []);
      subCtx.set('subagentActive', true);
      if (model) subCtx.set('model', model);

      const subThread = `subagent-${crypto.randomUUID()}`;
      subCtx.set('threadId', subThread);

      const result = (await agent.generate(envelopedPrompt, {
        memory: { thread: subThread, resource: userId },
        requestContext: subCtx,
        toolsets: toolsetsForPreset(preset, deps),
        abortSignal: ctx?.abortSignal,
      } as never)) as { text?: string };

      return {
        subagent_type: preset.key,
        summary: result?.text ?? '(no output)',
        taskId: null,
        background: false,
      };
    },
  });

  return { task };
}
