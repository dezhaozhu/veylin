import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { insertTask, updateTaskRow, getTaskRow } from '@veylin/db';
import { DEFAULT_AGENT_ID } from '@veylin/shared';
import {
  SUBAGENT_TYPES,
  formatPresetListing,
  type Runtime,
} from '@veylin/runtime';
import { SUBAGENT_QUEUE, type QueuePort, type SubagentJob } from './queue';
import {
  type AgentTaskRunnerDeps,
  ctxValue,
  devTenantFallback,
  resolveDispatchTarget,
  runSubagentGenerate,
  subagentTaskEnvelope,
  continueTaskThread,
} from './agent-task-runner';
import { buildTaskManagementTools } from './task-tools';

interface TaskCtx {
  requestContext?: { get(key: string): unknown; set?(key: string, value: unknown): void };
  abortSignal?: AbortSignal;
}

export interface AgentTaskToolDeps extends AgentTaskRunnerDeps {
  queue: QueuePort;
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
      .describe('Queue the task and return task_id immediately instead of waiting inline.'),
  });

  const task = createTool({
    id: 'task',
    description:
      'Dispatch a specialized subagent (Claude Code Agent tool). Pick subagent_type by need: ' +
      formatPresetListing() +
      '. For custom agent packages use agent_id. Omit both to fork with inherited conversation context (always background). Set run_in_background for long work and parallel dispatches. Continue workers with task_continue.',
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

      const label = input.description?.trim() || target.label;
      const enveloped = isFork ? input.prompt : subagentTaskEnvelope(label, input.prompt);
      const runBackground = isFork || input.run_in_background === true;

      if (runBackground) {
        const row = await insertTask({
          tenantId,
          parentThreadId: parentThreadId ?? null,
          agentId: target.agentId,
          prompt: enveloped,
          status: 'queued',
          label,
          subagentType: target.subagentType ?? null,
        });
        const taskId = row.id;
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
        return {
          subagent_type: target.subagentType ?? null,
          agent_id: isFork ? null : target.subagentType ? null : target.agentId,
          description: label,
          summary: null,
          task_id: taskId,
          background: true,
          notification: null,
        };
      }

      const subThread = `subagent-${crypto.randomUUID()}`;
      const result = await runSubagentGenerate({
        runtime,
        deps,
        agentId: target.agentId,
        preset: target.preset,
        prompt: enveloped,
        threadId: subThread,
        resourceId: userId,
        tenantId,
        abortSignal: ctx?.abortSignal,
        fork: isFork,
      });

      return {
        subagent_type: target.subagentType ?? null,
        agent_id: isFork ? null : target.subagentType ? null : target.agentId,
        description: label,
        summary: result.text,
        task_id: null,
        background: false,
        notification: null,
      };
    },
  });

  const taskContinue = createTool({
    id: 'task_continue',
    description:
      'Send a follow-up message to an existing subagent worker (Claude Code SendMessage). ' +
      'Use the task_id from a prior task dispatch or from a <task-notification>.',
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
        return {
          subagent_type: row.subagentType ?? null,
          agent_id: row.subagentType ? null : row.agentId,
          description: row.label ?? null,
          summary: null,
          task_id: row.id,
          background: true,
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

  const management = buildTaskManagementTools(deps.queue);

  return {
    task,
    task_continue: taskContinue,
    ...management,
  };
}
