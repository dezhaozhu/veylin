import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getTaskRow, insertTask, listTasksByParentThread, updateTaskRow } from '@veylin/db';
import { SUBAGENT_QUEUE, type QueuePort, type SubagentJob } from './queue';

interface TaskCtx {
  requestContext?: { get(key: string): unknown; set?(key: string, value: unknown): void };
}

function ctxValue(ctx: TaskCtx | undefined, key: string): string | undefined {
  return ctx?.requestContext?.get(key) as string | undefined;
}

export function buildTaskTools(boss: QueuePort) {
  const taskCreate = createTool({
    id: 'task_create',
    description:
      'Spawn a background sub-agent task. Returns a taskId you can poll with ' +
      'task_get / task_list. Use task_update or task_stop to manage it.',
    inputSchema: z.object({
      prompt: z.string().describe('Instruction for the sub-agent'),
      agentId: z.string().default('veylin'),
      label: z.string().optional(),
    }),
    outputSchema: z.object({ taskId: z.string(), jobId: z.string().nullable() }),
    execute: async (input, ctx?: TaskCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const parentThreadId = ctxValue(ctx, 'threadId');
      const parentResource = ctxValue(ctx, 'userId');

      const agentId = input.agentId ?? 'veylin';
      const label = input.label ?? agentId;
      const row = await insertTask({
        tenantId,
        parentThreadId: parentThreadId ?? null,
        agentId,
        prompt: input.prompt,
        label,
        status: 'queued',
      });

      const taskId = row.id;
      const job: SubagentJob = {
        tenantId,
        threadId: `task-${taskId}`,
        agentId,
        prompt: input.prompt,
        parentThreadId,
        parentResource,
        label,
        taskId,
      };
      const jobId = await boss.send(SUBAGENT_QUEUE, job);
      await updateTaskRow(taskId, { jobId: jobId ?? null });
      return { taskId, jobId: jobId ?? null };
    },
  });

  const taskList = createTool({
    id: 'task_list',
    description: 'List background tasks spawned from the current conversation.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      tasks: z.array(
        z.object({ id: z.string(), status: z.string(), label: z.string(), agentId: z.string() }),
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
        })),
      };
    },
  });

  const taskGet = createTool({
    id: 'task_get',
    description: 'Get a background task status and result by taskId.',
    inputSchema: z.object({ taskId: z.string() }),
    outputSchema: z.object({
      id: z.string(),
      status: z.string(),
      label: z.string().nullable(),
      result: z.string().nullable(),
      found: z.boolean(),
    }),
    execute: async (input) => {
      const row = await getTaskRow(input.taskId);
      if (!row) return { id: input.taskId, status: 'unknown', label: null, result: null, found: false };
      return {
        id: row.id,
        status: row.status,
        label: row.label ?? null,
        result: row.result ?? null,
        found: true,
      };
    },
  });

  const taskUpdate = createTool({
    id: 'task_update',
    description:
      'Update a queued or running task. Queued: change prompt/label. Running: cancel only.',
    inputSchema: z.object({
      taskId: z.string(),
      status: z.enum(['cancelled']).optional(),
      prompt: z.string().optional(),
      label: z.string().optional(),
    }),
    outputSchema: z.object({ ok: z.boolean(), status: z.string() }),
    execute: async (input, ctx?: TaskCtx) => {
      const row = await getTaskRow(input.taskId);
      if (!row) return { ok: false, status: 'unknown' };

      if (row.status === 'queued') {
        const patch: Parameters<typeof updateTaskRow>[1] = {};
        if (input.prompt) patch.prompt = input.prompt;
        if (input.label) patch.label = input.label;
        if (input.status === 'cancelled') patch.status = 'cancelled';
        await updateTaskRow(input.taskId, patch);
        if (input.status === 'cancelled' && row.jobId) {
          await boss.cancel(SUBAGENT_QUEUE, row.jobId).catch(() => undefined);
        }
        const next = await getTaskRow(input.taskId);
        return { ok: true, status: next?.status ?? row.status };
      }

      if (row.status === 'running' && input.status === 'cancelled') {
        await updateTaskRow(input.taskId, { status: 'cancelled' });
        if (row.jobId) await boss.cancel(SUBAGENT_QUEUE, row.jobId).catch(() => undefined);
        ctx?.requestContext?.set?.(`cancelledTask:${input.taskId}`, true);
        return { ok: true, status: 'cancelled' };
      }

      return { ok: false, status: row.status };
    },
  });

  const taskStop = createTool({
    id: 'task_stop',
    description: 'Cancel a queued or running background task.',
    inputSchema: z.object({ taskId: z.string() }),
    outputSchema: z.object({ ok: z.boolean(), status: z.string() }),
    execute: async (input, ctx?: TaskCtx) => {
      const row = await getTaskRow(input.taskId);
      if (!row) return { ok: false, status: 'unknown' };
      if (row.status === 'done' || row.status === 'failed' || row.status === 'cancelled') {
        return { ok: false, status: row.status };
      }
      await updateTaskRow(input.taskId, { status: 'cancelled' });
      if (row.jobId) await boss.cancel(SUBAGENT_QUEUE, row.jobId).catch(() => undefined);
      ctx?.requestContext?.set?.(`cancelledTask:${input.taskId}`, true);
      return { ok: true, status: 'cancelled' };
    },
  });

  return {
    task_create: taskCreate,
    task_list: taskList,
    task_get: taskGet,
    task_update: taskUpdate,
    task_stop: taskStop,
  };
}
