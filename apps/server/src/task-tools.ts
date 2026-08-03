import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getTaskRow, listTasksByParentThread } from '@veylin/db';
import type { Memory } from '@mastra/memory';
import type { QueuePort } from './queue';
import { writeTaskNotificationToParent } from './agent-task-runner';
import { cancelSubagentTask } from './cancel-thread-tasks';

interface TaskCtx {
  requestContext?: { get(key: string): unknown; set?(key: string, value: unknown): void };
}

function ctxValue(ctx: TaskCtx | undefined, key: string): string | undefined {
  return ctx?.requestContext?.get(key) as string | undefined;
}

/** task_list / task_get / task_stop — background task management (no task_create; use `task`). */
export function buildTaskManagementTools(
  boss: QueuePort,
  opts?: { memory?: Memory },
) {
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
      const result = await cancelSubagentTask(input.task_id, boss);
      if (result.ok && opts?.memory && row.parentThreadId) {
        const userId = ctxValue(ctx, 'userId') ?? row.tenantId;
        await writeTaskNotificationToParent({
          memory: opts.memory,
          parentThreadId: row.parentThreadId,
          parentResource: userId,
          notification: {
            taskId: row.id,
            status: 'killed',
            summary: `Agent "${row.label ?? row.agentId}" cancelled`,
            subagentType: row.subagentType ?? undefined,
            agentId: row.agentId,
          },
        }).catch(() => undefined);
      }
      return result;
    },
  });

  return {
    task_list: taskList,
    task_get: taskGet,
    task_stop: taskStop,
  };
}
