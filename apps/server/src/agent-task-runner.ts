import { RequestContext } from '@mastra/core/di';
import type { Memory } from '@mastra/memory';
import { formatTaskNotification, type TaskNotificationStatus } from '@veylin/shared';
import {
  SUBAGENT_PRESETS,
  FORK_SUBAGENT_TYPE,
  isSubagentPresetKey,
  subagentAgentId,
  type Runtime,
  type SubagentPreset,
} from '@veylin/runtime';
import { getTaskRow, updateTaskRow, type TaskRow } from '@veylin/db';
import type { SubagentJob } from './queue';
import { seedForkWorkerThread } from './agent-fork';

const DEV_TENANT_FALLBACK = '00000000-0000-0000-0000-000000000000';

export interface AgentTaskRunnerDeps {
  mcpToolsets: Record<string, unknown>;
}

export interface DispatchTarget {
  agentId: string;
  label: string;
  subagentType?: string;
  preset?: SubagentPreset;
  fork?: boolean;
}

export interface SubagentRunResult {
  text: string;
  durationMs: number;
  totalTokens?: number;
}

export function subagentTaskEnvelope(label: string, prompt: string): string {
  return [
    `You are the "${label}" subagent dispatched by a parent agent to handle one scoped task.`,
    '',
    'Operating rules:',
    '- Work autonomously and complete the task end to end with the tools available to you.',
    '- You CANNOT ask the user questions; if something is ambiguous, state your assumption and proceed.',
    '- You CANNOT dispatch further subagents.',
    '- Stay within the scope of the task below; do not take unrelated actions.',
    '- When done, return a concise, structured summary with concrete references the parent can act on.',
    '',
    'Task:',
    prompt,
  ].join('\n');
}

export function listDispatchableCustomAgentIds(runtime: Runtime, parentAgentId: string): string[] {
  const parent = runtime.definitions.get(parentAgentId)?.definition;
  const allowlist = parent?.subAgents ?? [];
  const all = runtime
    .listAgents()
    .map((a) => a.id)
    .filter((id) => !id.startsWith('subagent-') && id !== parentAgentId);
  if (allowlist.length === 0) return all;
  const allowed = new Set(allowlist);
  return all.filter((id) => allowed.has(id));
}

export function resolveDispatchTarget(
  runtime: Runtime,
  parentAgentId: string,
  input: { subagent_type?: string; agent_id?: string },
): DispatchTarget | { error: string } {
  if (input.subagent_type && input.agent_id) {
    return { error: 'Provide subagent_type or agent_id, not both.' };
  }

  if (input.subagent_type) {
    if (!isSubagentPresetKey(input.subagent_type)) {
      return { error: `Unknown subagent_type: ${input.subagent_type}` };
    }
    const preset = SUBAGENT_PRESETS[input.subagent_type]!;
    return {
      agentId: subagentAgentId(preset.key),
      label: preset.key,
      subagentType: preset.key,
      preset,
    };
  }

  const agentId = input.agent_id ?? '';
  if (!agentId) {
    return {
      agentId: parentAgentId,
      label: 'fork',
      subagentType: FORK_SUBAGENT_TYPE,
      fork: true,
    };
  }
  if (!runtime.getAgent(agentId)) {
    return { error: `Agent not registered: ${agentId}` };
  }
  const custom = listDispatchableCustomAgentIds(runtime, parentAgentId);
  if (!custom.includes(agentId)) {
    return { error: `Agent "${agentId}" is not dispatchable from this parent.` };
  }
  const summary = runtime.definitions.get(agentId);
  return {
    agentId,
    label: summary?.definition.name ?? agentId,
    subagentType: undefined,
  };
}

function toolsetsForPreset(
  preset: SubagentPreset | undefined,
  agentId: string,
  runtime: Runtime,
  deps: AgentTaskRunnerDeps,
  fork?: boolean,
): Record<string, unknown> {
  const declared = runtime.definitions.get(agentId)?.definition.mcpServers ?? [];
  const toolsets: Record<string, unknown> = {};
  const servers = fork ? declared : preset?.includeMcp?.length ? preset.includeMcp : declared;
  for (const server of servers) {
    if (deps.mcpToolsets[server]) toolsets[server] = deps.mcpToolsets[server];
  }
  return toolsets;
}

function extractUsage(result: unknown): { totalTokens?: number } {
  if (!result || typeof result !== 'object') return {};
  const r = result as Record<string, unknown>;
  const usage = r.usage ?? r.totalUsage;
  if (usage && typeof usage === 'object') {
    const u = usage as Record<string, unknown>;
    const prompt = u.promptTokens != null ? Number(u.promptTokens) : undefined;
    const completion = u.completionTokens != null ? Number(u.completionTokens) : undefined;
    const total =
      (u.totalTokens as number | undefined) ??
      (u.total_tokens as number | undefined) ??
      (prompt != null && completion != null ? prompt + completion : undefined);
    if (total != null) return { totalTokens: total };
  }
  return {};
}

export async function runSubagentGenerate(options: {
  runtime: Runtime;
  deps: AgentTaskRunnerDeps;
  agentId: string;
  preset?: SubagentPreset;
  prompt: string;
  threadId: string;
  resourceId: string;
  tenantId: string;
  abortSignal?: AbortSignal;
  fork?: boolean;
}): Promise<SubagentRunResult> {
  const agent = options.runtime.getAgent(options.agentId);
  if (!agent) throw new Error(`Agent not registered: ${options.agentId}`);

  const subCtx = new RequestContext();
  subCtx.set('tenantId', options.tenantId);
  subCtx.set('userId', options.resourceId);
  subCtx.set('threadId', options.threadId);
  subCtx.set('planMode', false);
  subCtx.set('discoveredToolIds', []);
  subCtx.set('subagentActive', true);

  const started = Date.now();
  const result = (await agent.generate(options.prompt, {
    memory: { thread: options.threadId, resource: options.resourceId },
    requestContext: subCtx,
    toolsets: toolsetsForPreset(options.preset, options.agentId, options.runtime, options.deps, options.fork),
    abortSignal: options.abortSignal,
  } as never)) as { text?: string };
  const durationMs = Date.now() - started;
  const { totalTokens } = extractUsage(result);

  return {
    text: result?.text ?? '(no output)',
    durationMs,
    totalTokens,
  };
}

export async function writeTaskNotificationToParent(options: {
  memory: Memory;
  parentThreadId: string;
  parentResource: string;
  notification: {
    taskId: string;
    status: TaskNotificationStatus;
    summary: string;
    result?: string;
    durationMs?: number;
    totalTokens?: number;
    subagentType?: string;
    agentId?: string;
  };
}): Promise<void> {
  const text = formatTaskNotification({
    taskId: options.notification.taskId,
    status: options.notification.status,
    summary: options.notification.summary,
    result: options.notification.result,
    subagent_type: options.notification.subagentType,
    agent_id: options.notification.agentId,
    usage: {
      duration_ms: options.notification.durationMs,
      total_tokens: options.notification.totalTokens,
    },
  });

  await options.memory.saveMessages({
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'user',
        createdAt: new Date(),
        threadId: options.parentThreadId,
        resourceId: options.parentResource,
        content: { format: 2, parts: [{ type: 'text', text }] },
      },
    ],
  } as never);
}

export async function executeSubagentJob(
  runtime: Runtime,
  deps: AgentTaskRunnerDeps,
  job: SubagentJob,
): Promise<SubagentRunResult> {
  const preset =
    job.subagentType && job.subagentType !== FORK_SUBAGENT_TYPE
      ? SUBAGENT_PRESETS[job.subagentType]
      : undefined;
  const workerThread = job.threadId;
  const isFork = job.fork === true || job.subagentType === FORK_SUBAGENT_TYPE;

  if (job.taskId) {
    const row = await getTaskRow(job.taskId);
    if (row?.status === 'cancelled') {
      throw new CancelledTaskError();
    }
    await updateTaskRow(job.taskId, { status: 'running', workerThreadId: workerThread });
  }

  try {
    let generatePrompt = job.prompt;
    if (isFork && job.parentThreadId && job.directive) {
      await seedForkWorkerThread({
        memory: runtime.memory,
        parentThreadId: job.parentThreadId,
        parentResource: job.parentResource ?? job.tenantId,
        workerThreadId: workerThread,
        forkName: job.label ?? 'fork',
        directive: job.directive,
      });
      generatePrompt = 'Proceed with the fork directive above.';
    } else if (isFork) {
      const followUp = job.prompt.includes('\n---\nFollow-up:\n')
        ? job.prompt.split('\n---\nFollow-up:\n').pop()!.trim()
        : job.prompt;
      await runtime.memory.saveMessages({
        messages: [
          {
            id: crypto.randomUUID(),
            role: 'user',
            createdAt: new Date(),
            threadId: workerThread,
            resourceId: job.parentResource ?? job.tenantId,
            content: { format: 2, parts: [{ type: 'text', text: `Follow-up:\n${followUp}` }] },
          },
        ],
      } as never);
      generatePrompt = followUp;
    }

    const result = await runSubagentGenerate({
      runtime,
      deps,
      agentId: job.agentId,
      preset,
      prompt: generatePrompt,
      threadId: workerThread,
      resourceId: job.parentResource ?? job.tenantId,
      tenantId: job.tenantId,
      fork: isFork,
    });

    if (job.taskId) {
      const row = await getTaskRow(job.taskId);
      if (row?.status === 'cancelled') throw new CancelledTaskError();
      await updateTaskRow(job.taskId, {
        status: 'done',
        result: result.text,
        totalTokens: result.totalTokens ?? null,
        durationMs: result.durationMs,
        workerThreadId: workerThread,
      });
    }

    if (job.parentThreadId) {
      const label = job.label ?? job.agentId;
      await writeTaskNotificationToParent({
        memory: runtime.memory,
        parentThreadId: job.parentThreadId,
        parentResource: job.parentResource ?? job.tenantId,
        notification: {
          taskId: job.taskId ?? workerThread,
          status: 'completed',
          summary: `Agent "${label}" completed`,
          result: result.text,
          durationMs: result.durationMs,
          totalTokens: result.totalTokens,
          subagentType: job.subagentType,
          agentId: isFork ? undefined : job.agentId,
        },
      });
    }

    return result;
  } catch (err) {
    if (err instanceof CancelledTaskError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (job.taskId) {
      await updateTaskRow(job.taskId, {
        status: 'failed',
        result: message,
      }).catch(() => undefined);
    }
    if (job.parentThreadId) {
      await writeTaskNotificationToParent({
        memory: runtime.memory,
        parentThreadId: job.parentThreadId,
        parentResource: job.parentResource ?? job.tenantId,
        notification: {
          taskId: job.taskId ?? workerThread,
          status: 'failed',
          summary: `Agent "${job.label ?? job.agentId}" failed: ${message}`,
          subagentType: job.subagentType,
          agentId: isFork ? undefined : job.agentId,
        },
      }).catch(() => undefined);
    }
    throw err;
  }
}

export class CancelledTaskError extends Error {
  constructor() {
    super('task cancelled');
    this.name = 'CancelledTaskError';
  }
}

export function ctxValue(
  ctx: { requestContext?: { get(key: string): unknown } } | undefined,
  key: string,
): string | undefined {
  return ctx?.requestContext?.get(key) as string | undefined;
}

export function devTenantFallback(): string {
  return DEV_TENANT_FALLBACK;
}

export async function continueTaskThread(
  task: TaskRow,
  message: string,
  runtime: Runtime,
  deps: AgentTaskRunnerDeps,
  resourceId: string,
): Promise<SubagentRunResult> {
  const threadId = task.workerThreadId ?? `task-${task.id}`;
  const isFork = task.subagentType === FORK_SUBAGENT_TYPE;

  if (isFork) {
    await updateTaskRow(task.id, { status: 'running' });
    await runtime.memory.saveMessages({
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          createdAt: new Date(),
          threadId,
          resourceId,
          content: {
            format: 2,
            parts: [{ type: 'text', text: `Follow-up:\n${message}` }],
          },
        },
      ],
    } as never);
    const combined = `${task.prompt}\n\n---\nFollow-up:\n${message}`;
    await updateTaskRow(task.id, { prompt: combined });
    const preset = undefined;
    return runSubagentGenerate({
      runtime,
      deps,
      agentId: task.agentId,
      preset,
      prompt: message,
      threadId,
      resourceId,
      tenantId: task.tenantId,
      fork: true,
    });
  }

  const combined = `${task.prompt}\n\n---\nFollow-up:\n${message}`;
  await updateTaskRow(task.id, { prompt: combined, status: 'running' });

  const preset = task.subagentType ? SUBAGENT_PRESETS[task.subagentType] : undefined;
  return runSubagentGenerate({
    runtime,
    deps,
    agentId: task.agentId,
    preset,
    prompt: combined,
    threadId,
    resourceId,
    tenantId: task.tenantId,
  });
}
