import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getTaskRow, listTasksByParentThread, updateTaskRow } from '@veylin/db';
import { SUBAGENT_QUEUE, type QueuePort } from './queue';

interface TaskCtx {
  requestContext?: { get(key: string): unknown; set?(key: string, value: unknown): void };
}

function ctxValue(ctx: TaskCtx | undefined, key: string): string | undefined {
  return ctx?.requestContext?.get(key) as string | undefined;
}

/** task_list / task_get / task_stop — background task management (no task_create; use `task`). */
export function buildTaskManagementTools(boss: QueuePort) {
  const taskList = createTool({
    id: 'task_list',
    description: 'List background subagent tasks spawned from the current conversation.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      tasks: z.array(
        z.object({
          id: z.string(),
          status: z.string(),
          label: z.string(),
          agentId: z.string(),
          subagentType: z.string().nullable(),
        }),
      ),
    }),
    execute: async (_input, ctx?: TaskCtx) => {
      const parentThreadId = ctxValue(ctx, 'threadId');
      const rows = parentThreadId ? await listTasksByParentThread(parentThreadId) : [];
      return {
        tasks: rows.map((r) => ({
          id: r.id,
          status: r.status,
          label: r.label ?? r.agentId,
          agentId: r.agentId,
          subagentType: r.subagentType ?? null,
        })),
      };
    },
  });

  const taskGet = createTool({
    id: 'task_get',
    description: 'Get a background task status, result, and usage by task_id.',
    inputSchema: z.object({ task_id: z.string() }),
    outputSchema: z.object({
      id: z.string(),
      status: z.string(),
      label: z.string().nullable(),
      result: z.string().nullable(),
      subagentType: z.string().nullable(),
      agentId: z.string().nullable(),
      totalTokens: z.number().nullable(),
      durationMs: z.number().nullable(),
      found: z.boolean(),
    }),
    execute: async (input) => {
      const row = await getTaskRow(input.task_id);
      if (!row) {
        return {
          id: input.task_id,
          status: 'unknown',
          label: null,
          result: null,
          subagentType: null,
          agentId: null,
          totalTokens: null,
          durationMs: null,
          found: false,
        };
      }
      return {
        id: row.id,
        status: row.status,
        label: row.label ?? null,
        result: row.result ?? null,
        subagentType: row.subagentType ?? null,
        agentId: row.agentId,
        totalTokens: row.totalTokens ?? null,
        durationMs: row.durationMs ?? null,
        found: true,
      };
    },
  });

  const taskStop = createTool({
    id: 'task_stop',
    description: 'Cancel a queued or running background subagent task.',
    inputSchema: z.object({ task_id: z.string() }),
    outputSchema: z.object({ ok: z.boolean(), status: z.string() }),
    execute: async (input, ctx?: TaskCtx) => {
      const row = await getTaskRow(input.task_id);
      if (!row) return { ok: false, status: 'unknown' };
      if (row.status === 'done' || row.status === 'failed' || row.status === 'cancelled') {
        return { ok: false, status: row.status };
      }
      await updateTaskRow(input.task_id, { status: 'cancelled' });
      if (row.jobId) await boss.cancel(SUBAGENT_QUEUE, row.jobId).catch(() => undefined);
      ctx?.requestContext?.set?.(`cancelledTask:${input.task_id}`, true);
      return { ok: true, status: 'cancelled' };
    },
  });

  return {
    task_list: taskList,
    task_get: taskGet,
    task_stop: taskStop,
  };
}

/** @deprecated Use buildTaskManagementTools */
export function buildTaskTools(boss: QueuePort) {
  return buildTaskManagementTools(boss);
}
