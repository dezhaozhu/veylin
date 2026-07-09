import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { insertTask, updateTaskRow, getTaskRow } from '@veylin/db';
import { DEFAULT_AGENT_ID, deriveTaskLabel } from '@veylin/shared';
import {
  SUBAGENT_TYPES,
  formatPresetListing,
  type Runtime,
} from '@veylin/runtime';
import { SUBAGENT_QUEUE, type QueuePort, type SubagentJob } from './queue';
import {
  type AgentTaskRunnerDeps,
  awaitTaskCompletion,
  ctxValue,
  devTenantFallback,
  resolveDispatchTarget,
  runSubagentGenerate,
  subagentTaskEnvelope,
  continueTaskThread,
} from './agent-task-runner';
import { buildTaskManagementTools } from './task-tools';
import { clearTaskProgress } from './task-progress-store';
import { publishTaskEvent } from './task-events';

interface TaskCtx {
  requestContext?: { get(key: string): unknown; set?(key: string, value: unknown): void };
  abortSignal?: AbortSignal;
}

function resolveToolAbortSignal(ctx?: TaskCtx): AbortSignal | undefined {
  const fromRun = ctx?.requestContext?.get('runAbortSignal');
  if (fromRun instanceof AbortSignal) return fromRun;
  return ctx?.abortSignal;
}

export interface AgentTaskToolDeps extends AgentTaskRunnerDeps {
  queue: QueuePort;
}

/**
 * Block on a queued worker and return its result text for the parent agent to act on.
 * Keeps worker isolation/concurrency (queue) while behaving like a synchronous Claude
 * Code Task tool: the parent continues via native tool-result continuation, not a
 * client-side synthesis re-POST. If the parent stream aborts, the task is cancelled.
 */
async function awaitDispatchedTaskResult(
  deps: AgentTaskToolDeps,
  options: {
    taskId: string;
    jobId: string | null;
    parentThreadId?: string;
    label: string;
    abortSignal?: AbortSignal;
  },
): Promise<string> {
  const { taskId, jobId, parentThreadId, label, abortSignal } = options;
  const row = await awaitTaskCompletion({ taskId, parentThreadId, abortSignal });
  if (!row || row.status === 'cancelled') {
    if (jobId) await deps.queue.cancel(SUBAGENT_QUEUE, jobId).catch(() => undefined);
    await updateTaskRow(taskId, { status: 'cancelled' }).catch(() => undefined);
    if (parentThreadId) {
      publishTaskEvent({ kind: 'task.updated', threadId: parentThreadId, taskId });
    }
    return `Agent "${label}" was cancelled before completing.`;
  }
  if (row.status === 'failed') {
    return `Agent "${label}" failed: ${row.result ?? 'unknown error'}`;
  }
  return row.result ?? '(no output)';
}

const taskOutputSchema = z.object({
  subagent_type: z.string().nullable(),
  agent_id: z.string().nullable(),
  description: z.string().nullable(),
  summary: z.string().nullable(),
  task_id: z.string().nullable(),
  background: z.boolean(),
  notification: z.string().nullable(),
});

export function buildAgentTaskTools(runtime: Runtime, deps: AgentTaskToolDeps) {
  const dispatchInputSchema = z.object({
    description: z
      .string()
      .optional()
      .describe('Short human-readable label for this task (shown in the UI).'),
    subagent_type: z
      .enum(SUBAGENT_TYPES as [string, ...string[]])
      .optional()
      .describe('Built-in subagent preset. Omit with agent_id to fork with inherited parent context.'),
    agent_id: z
      .string()
      .optional()
      .describe('Registered custom agent id. Omit both subagent_type and agent_id to fork.'),
    prompt: z.string().describe('Self-contained instruction for the subagent.'),
    run_in_background: z
      .boolean()
      .optional()
      .describe(
        'Run the worker on the isolated queue (used for forks and long jobs). The call still waits for the result inline; for parallel work issue multiple task calls in one step.',
      ),
  });

  const task = createTool({
    id: 'task',
    description:
      'Dispatch a specialized subagent (Claude Code Agent tool) and wait for its result inline. Pick subagent_type by need: ' +
      formatPresetListing() +
      '. For custom agent packages use agent_id. Omit both to fork with inherited conversation context. To run subagents in parallel, issue multiple task calls in a single step; each returns its own result and you continue once all complete. Continue a worker with task_continue.',
    inputSchema: dispatchInputSchema,
    outputSchema: taskOutputSchema,
    execute: async (input, ctx?: TaskCtx) => {
      if (ctx?.requestContext?.get('subagentActive') === true) {
        return {
          subagent_type: input.subagent_type ?? null,
          agent_id: input.agent_id ?? null,
          description: input.description ?? null,
          summary: 'A subagent cannot dispatch further subagents.',
          task_id: null,
          background: false,
          notification: null,
        };
      }

      const tenantId = ctxValue(ctx, 'tenantId') ?? devTenantFallback();
      const userId = ctxValue(ctx, 'userId') ?? tenantId;
      const parentThreadId = ctxValue(ctx, 'threadId');
      const parentAgentId = ctxValue(ctx, 'parentAgentId') ?? DEFAULT_AGENT_ID;

      const target = resolveDispatchTarget(runtime, parentAgentId, {
        subagent_type: input.subagent_type,
        agent_id: input.agent_id,
      });
      if ('error' in target) {
        return {
          subagent_type: input.subagent_type ?? null,
          agent_id: input.agent_id ?? null,
          description: input.description ?? null,
          summary: target.error,
          task_id: null,
          background: false,
          notification: null,
        };
      }

      const isFork = target.fork === true;
      if (isFork && !input.description?.trim()) {
        return {
          subagent_type: null,
          agent_id: null,
          description: null,
          summary: 'Fork requires a short description (name for the fork).',
          task_id: null,
          background: false,
          notification: null,
        };
      }

      const label = deriveTaskLabel({
        description: input.description,
        prompt: input.prompt,
        subagentType: target.subagentType ?? null,
        agentId: target.agentId,
        defaultLabel: target.label,
      });
      const enveloped = isFork ? input.prompt : subagentTaskEnvelope(label, input.prompt);
      const runBackground = isFork || input.run_in_background === true;

      // Always persist a task row so the UI can bind progress (tool uses / last tool)
      // under the parent tool call via /api/tasks SSE — even for inline sync runs.
      const row = await insertTask({
        tenantId,
        parentThreadId: parentThreadId ?? null,
        agentId: target.agentId,
        prompt: enveloped,
        status: runBackground ? 'queued' : 'running',
        label,
        subagentType: target.subagentType ?? null,
      });
      const taskId = row.id;
      if (parentThreadId) {
        publishTaskEvent({ kind: 'task.updated', threadId: parentThreadId, taskId });
      }

      if (runBackground) {
        const workerThread = `task-${taskId}`;
        const job: SubagentJob = {
          tenantId,
          threadId: workerThread,
          agentId: target.agentId,
          prompt: enveloped,
          parentThreadId,
          parentResource: userId,
          label,
          taskId,
          subagentType: target.subagentType,
          fork: isFork,
          directive: isFork ? input.prompt : undefined,
        };
        const jobId = await deps.queue.send(SUBAGENT_QUEUE, job);
        await updateTaskRow(taskId, { jobId: jobId ?? null, workerThreadId: workerThread });
        if (parentThreadId) {
          publishTaskEvent({ kind: 'task.updated', threadId: parentThreadId, taskId });
        }
        const summary = await awaitDispatchedTaskResult(deps, {
          taskId,
          jobId: jobId ?? null,
          parentThreadId,
          label,
          abortSignal: resolveToolAbortSignal(ctx),
        });
        return {
          subagent_type: target.subagentType ?? null,
          agent_id: isFork ? null : target.subagentType ? null : target.agentId,
          description: label,
          summary,
          task_id: taskId,
          background: false,
          notification: null,
        };
      }

      const subThread = `subagent-${taskId}`;
      try {
        const result = await runSubagentGenerate({
          runtime,
          deps,
          agentId: target.agentId,
          preset: target.preset,
          prompt: enveloped,
          threadId: subThread,
          resourceId: userId,
          tenantId,
          abortSignal: resolveToolAbortSignal(ctx),
          fork: isFork,
          parentThreadId,
          taskId,
        });
        await updateTaskRow(taskId, {
          status: 'done',
          result: result.text,
          totalTokens: result.totalTokens ?? null,
          durationMs: result.durationMs,
          workerThreadId: subThread,
        });
        if (parentThreadId) {
          publishTaskEvent({ kind: 'task.updated', threadId: parentThreadId, taskId });
        }
        return {
          subagent_type: target.subagentType ?? null,
          agent_id: isFork ? null : target.subagentType ? null : target.agentId,
          description: label,
          summary: result.text,
          task_id: taskId,
          background: false,
          notification: null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await updateTaskRow(taskId, { status: 'failed', result: message }).catch(() => undefined);
        clearTaskProgress(taskId);
        if (parentThreadId) {
          publishTaskEvent({ kind: 'task.updated', threadId: parentThreadId, taskId });
        }
        throw err;
      }
    },
  });

  const taskContinue = createTool({
    id: 'task_continue',
    description:
      'Send a follow-up message to an existing subagent worker. ' +
      'Use the task_id from a prior task tool result.',
    inputSchema: z.object({
      task_id: z.string().describe('Task id to continue.'),
      message: z.string().describe('Follow-up instruction for the worker.'),
      run_in_background: z.boolean().optional(),
    }),
    outputSchema: taskOutputSchema,
    execute: async (input, ctx?: TaskCtx) => {
      const row = await getTaskRow(input.task_id);
      if (!row) {
        return {
          subagent_type: null,
          agent_id: null,
          description: null,
          summary: `Task not found: ${input.task_id}`,
          task_id: input.task_id,
          background: false,
          notification: null,
        };
      }

      const tenantId = ctxValue(ctx, 'tenantId') ?? devTenantFallback();
      const userId = ctxValue(ctx, 'userId') ?? tenantId;
      const parentThreadId = ctxValue(ctx, 'threadId');

      if (input.run_in_background === true) {
        const enveloped = `${row.prompt}\n\n---\nFollow-up:\n${input.message}`;
        await updateTaskRow(row.id, { prompt: enveloped, status: 'queued' });
        if (parentThreadId ?? row.parentThreadId) {
          publishTaskEvent({
            kind: 'task.updated',
            threadId: parentThreadId ?? row.parentThreadId!,
            taskId: row.id,
          });
        }
        const workerThread = row.workerThreadId ?? `task-${row.id}`;
        const job: SubagentJob = {
          tenantId,
          threadId: workerThread,
          agentId: row.agentId,
          prompt: enveloped,
          parentThreadId: parentThreadId ?? row.parentThreadId ?? undefined,
          parentResource: userId,
          label: row.label ?? row.agentId,
          taskId: row.id,
          subagentType: row.subagentType ?? undefined,
        };
        const jobId = await deps.queue.send(SUBAGENT_QUEUE, job);
        await updateTaskRow(row.id, { jobId: jobId ?? null, workerThreadId: workerThread });
        const continueParentThreadId = parentThreadId ?? row.parentThreadId ?? undefined;
        if (continueParentThreadId) {
          publishTaskEvent({
            kind: 'task.updated',
            threadId: continueParentThreadId,
            taskId: row.id,
          });
        }
        const summary = await awaitDispatchedTaskResult(deps, {
          taskId: row.id,
          jobId: jobId ?? null,
          parentThreadId: continueParentThreadId,
          label: row.label ?? row.agentId,
          abortSignal: resolveToolAbortSignal(ctx),
        });
        return {
          subagent_type: row.subagentType ?? null,
          agent_id: row.subagentType ? null : row.agentId,
          description: row.label ?? null,
          summary,
          task_id: row.id,
          background: false,
          notification: null,
        };
      }

      const result = await continueTaskThread(row, input.message, runtime, deps, userId);
      await updateTaskRow(row.id, {
        status: 'done',
        result: result.text,
        totalTokens: result.totalTokens ?? null,
        durationMs: result.durationMs,
      });
      if (parentThreadId ?? row.parentThreadId) {
        publishTaskEvent({
          kind: 'task.updated',
          threadId: parentThreadId ?? row.parentThreadId!,
          taskId: row.id,
        });
      }

      return {
        subagent_type: row.subagentType ?? null,
        agent_id: row.subagentType ? null : row.agentId,
        description: row.label ?? null,
        summary: result.text,
        task_id: row.id,
        background: false,
        notification: null,
      };
    },
  });

  const management = buildTaskManagementTools(deps.queue, { memory: runtime.memory });

  return {
    task,
    task_continue: taskContinue,
    ...management,
  };
}
