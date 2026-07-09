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
import { getTaskRow, updateTaskRow, type TaskRow, type TaskStatus } from '@veylin/db';
import type { SubagentJob } from './queue';
import { seedForkWorkerThread } from './agent-fork';
import { publishTaskEvent, subscribeTaskEvents } from './task-events';
import {
  clearTaskProgress,
  formatTaskActivity,
  setTaskProgress,
} from './task-progress-store';

const DEV_TENANT_FALLBACK = '00000000-0000-0000-0000-000000000000';

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(['done', 'failed', 'cancelled']);
const TASK_POLL_INTERVAL_MS = 500;

/**
 * Block until a queued/running task reaches a terminal state. Driven by task-event
 * wakeups with DB polling as a fallback so the dispatching tool call can return the
 * worker's result inline (synchronous Claude Code style Task), instead of relying on
 * a client-side synthesis re-POST. Resolves null when aborted by the parent stream.
 */
export async function awaitTaskCompletion(options: {
  taskId: string;
  parentThreadId?: string | null;
  abortSignal?: AbortSignal;
  pollIntervalMs?: number;
  /** Override the row fetcher (tests); defaults to the DB-backed getTaskRow. */
  getRow?: (taskId: string) => Promise<TaskRow | null>;
}): Promise<TaskRow | null> {
  const { taskId, parentThreadId, abortSignal } = options;
  const pollIntervalMs = options.pollIntervalMs ?? TASK_POLL_INTERVAL_MS;
  const getRow = options.getRow ?? getTaskRow;

  const initial = await getRow(taskId);
  if (initial && TERMINAL_TASK_STATUSES.has(initial.status)) return initial;

  return new Promise<TaskRow | null>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;
    let onAbort: (() => void) | null = null;

    const finish = (row: TaskRow | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      if (onAbort && abortSignal) abortSignal.removeEventListener('abort', onAbort);
      resolve(row);
    };

    const poll = async () => {
      if (settled) return;
      let row: TaskRow | null = null;
      try {
        row = await getRow(taskId);
      } catch {
        /* transient DB error — retry on next tick */
      }
      if (settled) return;
      if (row && TERMINAL_TASK_STATUSES.has(row.status)) {
        finish(row);
        return;
      }
      timer = setTimeout(() => void poll(), pollIntervalMs);
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        finish(null);
        return;
      }
      onAbort = () => finish(null);
      abortSignal.addEventListener('abort', onAbort);
    }

    if (parentThreadId) {
      unsubscribe = subscribeTaskEvents(parentThreadId, (event) => {
        if (event.taskId === taskId) void poll();
      });
    }

    void poll();
  });
}

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
    '- End-of-turn: one sentence on what changed and what is next.',
    '- Record load-bearing facts from tool results in your reply before moving on; old tool output may be cleared later.',
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

function formatToolArgsPreview(args: unknown, maxLen = 120): string | null {
  if (args == null) return null;
  let text: string;
  try {
    text = typeof args === 'string' ? args : JSON.stringify(args);
  } catch {
    return null;
  }
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact || compact === '{}' || compact === 'null') return null;
  return compact.length > maxLen ? `${compact.slice(0, maxLen - 1)}…` : compact;
}

function lastToolCallFromStep(step: unknown): {
  name: string;
  argsPreview: string | null;
} | null {
  if (!step || typeof step !== 'object') return null;
  const s = step as Record<string, unknown>;
  const calls = s.toolCalls;
  if (!Array.isArray(calls) || calls.length === 0) return null;

  let last: { name: string; argsPreview: string | null } | null = null;
  for (const call of calls) {
    if (!call || typeof call !== 'object') continue;
    const c = call as Record<string, unknown>;
    const payload =
      c.payload && typeof c.payload === 'object'
        ? (c.payload as Record<string, unknown>)
        : c;
    const name =
      (typeof payload.toolName === 'string' && payload.toolName) ||
      (typeof c.toolName === 'string' && c.toolName) ||
      null;
    if (!name) continue;
    const args =
      payload.args ??
      payload.input ??
      c.args ??
      c.input ??
      null;
    last = { name, argsPreview: formatToolArgsPreview(args) };
  }
  return last;
}

/** @deprecated Prefer lastToolCallFromStep — kept for call-site clarity. */
function toolNamesFromStep(step: unknown): string[] {
  if (!step || typeof step !== 'object') return [];
  const s = step as Record<string, unknown>;
  const calls = s.toolCalls;
  if (!Array.isArray(calls)) return [];
  const names: string[] = [];
  for (const call of calls) {
    if (!call || typeof call !== 'object') continue;
    const c = call as Record<string, unknown>;
    const payload =
      c.payload && typeof c.payload === 'object'
        ? (c.payload as Record<string, unknown>)
        : c;
    const name =
      (typeof payload.toolName === 'string' && payload.toolName) ||
      (typeof c.toolName === 'string' && c.toolName) ||
      null;
    if (name) names.push(name);
  }
  return names;
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
  /** Parent chat thread — used to publish live progress for TaskToolUI. */
  parentThreadId?: string | null;
  taskId?: string | null;
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

  const taskId = options.taskId ?? null;
  const parentThreadId = options.parentThreadId ?? null;
  let toolUseCount = 0;

  if (taskId) {
    setTaskProgress(taskId, {
      toolUseCount: 0,
      lastToolName: null,
      lastToolArgs: null,
      currentActivity: 'Initializing…',
      totalTokens: null,
    });
    if (parentThreadId) {
      publishTaskEvent({ kind: 'task.updated', threadId: parentThreadId, taskId });
    }
  }

  const started = Date.now();
  const result = (await agent.generate(options.prompt, {
    memory: { thread: options.threadId, resource: options.resourceId },
    requestContext: subCtx,
    toolsets: toolsetsForPreset(options.preset, options.agentId, options.runtime, options.deps, options.fork),
    abortSignal: options.abortSignal,
    onStepFinish: (step: unknown) => {
      if (!taskId) return;
      const names = toolNamesFromStep(step);
      if (names.length === 0) return;
      toolUseCount += names.length;
      const lastCall = lastToolCallFromStep(step);
      const lastToolName = lastCall?.name ?? names[names.length - 1] ?? null;
      const lastToolArgs = lastCall?.argsPreview ?? null;
      const progress = setTaskProgress(taskId, {
        toolUseCount,
        lastToolName,
        lastToolArgs,
        currentActivity: lastToolName
          ? lastToolArgs
            ? `${lastToolName} ${lastToolArgs}`
            : lastToolName
          : formatTaskActivity({
              toolUseCount,
              lastToolName: null,
              lastToolArgs: null,
              currentActivity: null,
              totalTokens: null,
              updatedAt: Date.now(),
            }),
      });
      if (parentThreadId) {
        publishTaskEvent({ kind: 'task.updated', threadId: parentThreadId, taskId });
      }
      void progress;
    },
  } as never)) as { text?: string };
  const durationMs = Date.now() - started;
  const { totalTokens } = extractUsage(result);

  if (taskId) {
    setTaskProgress(taskId, {
      toolUseCount,
      totalTokens: totalTokens ?? null,
      currentActivity: null,
    });
  }

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
        id: `task-notif-${options.notification.taskId}`,
        role: 'user',
        createdAt: new Date(),
        threadId: options.parentThreadId,
        resourceId: options.parentResource,
        content: { format: 2, parts: [{ type: 'text', text }] },
      },
    ],
  } as never);
  publishTaskEvent({
    kind: 'batch.readiness',
    threadId: options.parentThreadId,
    taskId: options.notification.taskId,
  });
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
    if (job.parentThreadId) {
      publishTaskEvent({ kind: 'task.updated', threadId: job.parentThreadId, taskId: job.taskId });
    }
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
      parentThreadId: job.parentThreadId,
      taskId: job.taskId,
      abortSignal: job.abortSignal,
    });

    if (job.abortSignal?.aborted) {
      throw new CancelledTaskError();
    }

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
      setTaskProgress(job.taskId, {
        currentActivity: null,
        totalTokens: result.totalTokens ?? null,
      });
      if (job.parentThreadId) {
        publishTaskEvent({ kind: 'task.updated', threadId: job.parentThreadId, taskId: job.taskId });
      }
    }

    // Synchronous Task model: the dispatching `task` tool awaits this worker and
    // returns `result.text` (persisted on the task row above) as the tool result, so
    // the parent agent continues natively via AI SDK tool-result continuation. We no
    // longer inject a <task-notification> into parent memory (that drove the removed
    // client-side synthesis path and would duplicate the tool result in context).

    return result;
  } catch (err) {
    const aborted =
      err instanceof CancelledTaskError ||
      job.abortSignal?.aborted ||
      (err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message)));
    if (aborted) {
      if (job.taskId) {
        await updateTaskRow(job.taskId, { status: 'cancelled' }).catch(() => undefined);
        clearTaskProgress(job.taskId);
        if (job.parentThreadId) {
          publishTaskEvent({ kind: 'task.updated', threadId: job.parentThreadId, taskId: job.taskId });
        }
      }
      throw err instanceof CancelledTaskError ? err : new CancelledTaskError();
    }
    const message = err instanceof Error ? err.message : String(err);
    if (job.taskId) {
      await updateTaskRow(job.taskId, {
        status: 'failed',
        result: message,
      }).catch(() => undefined);
      clearTaskProgress(job.taskId);
      if (job.parentThreadId) {
        publishTaskEvent({ kind: 'task.updated', threadId: job.parentThreadId, taskId: job.taskId });
      }
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
