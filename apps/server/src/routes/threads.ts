import { recallOrEmpty } from '../memory-recall.js';
import type { FastifyInstance } from 'fastify';
import { setThreadPlanMode } from '@veylin/tools';
import {
  ContextCompression,
  buildSummarizer,
  type ModelKey,
  type Runtime,
} from '@veylin/runtime';
import { listTasksByParentThread, getTaskRow } from '@veylin/db';
import {
  activateSkill,
  deleteThreadState,
  ensureThreadState,
  getThreadState,
  listThreadProjects,
  listThreadsForResource,
  requireThreadOwnership,
  resolveThreadForRead,
  restoreTodosFromHistoryIfEmpty,
  setPlanMode as setThreadPlanModeDb,
  setProjectWithMoveTracking,
  setThreadTitle,
  syncWorkingMemory,
  touchThreadActivity,
} from '../thread-state.js';
import { listThreadActivity } from '../thread-activity.js';
import { isMemoryStoreFailure, syncThreadMessagesFromClient } from '../thread-sync.js';
import { runPostCompactCleanup } from '../post-compact-cleanup.js';
import { isDatastoreFailure } from '../store-errors.js';
import { generateThreadTitle } from '../thread-title.js';
import {
  mastraMessagesToAgentContext,
  mastraMessagesToUi,
  evaluateBackgroundBatchReadiness,
  resolveSnapshotBatchRows,
  type UiMessage,
} from '../message-sync.js';
import { applyTenantModelSettings } from '../model-settings-store.js';
import { listMcpServerGroups } from '../mcp-store.js';
import { stopChatStream } from '../resumable-chat-stream.js';
import { cancelSubagentTask } from '../cancel-thread-tasks.js';
import type { TaskEvent } from '../task-events.js';
import { getTaskProgress } from '../task-progress-store.js';
import type { RequestContext } from '../server-context.js';
import type { ServerDeps, TasksSnapshot } from './types.js';

function parseBatchIds(batchIdsRaw: string | undefined): string[] {
  return batchIdsRaw
    ? batchIdsRaw.split(',').map((id) => id.trim()).filter(Boolean)
    : [];
}

export function createReadTaskSnapshot(runtime: Runtime) {
  return async function readTaskSnapshot(
    threadId: string,
    ctx: RequestContext,
    batchIdsRaw?: string,
  ): Promise<TasksSnapshot> {
    const row = await resolveThreadForRead(threadId, ctx);
    if (!row) return { tasks: [] };
    const rows = await listTasksByParentThread(threadId);
    const batchIdList = parseBatchIds(batchIdsRaw);
    const batchRows = resolveSnapshotBatchRows(rows, batchIdList);

    let batch: TasksSnapshot['batch'];

    if (batchRows.length > 0) {
      const recalled = await recallOrEmpty(runtime.memory, {
        threadId,
        resourceId: ctx.userId,
        perPage: false,
      });
      const agentContext = mastraMessagesToAgentContext(recalled.messages ?? []);
      const readiness = evaluateBackgroundBatchReadiness(batchRows, agentContext);
      batch = {
        taskIds: batchRows.map((r) => r.id),
        notificationsReady: readiness.notificationsReady,
        synthesisReady: readiness.synthesisReady,
        terminalCount: batchRows.filter((r) =>
          ['done', 'failed', 'cancelled'].includes(r.status),
        ).length,
        totalCount: batchRows.length,
      };
    }

    return {
      tasks: rows.map((r) => {
        const progress = getTaskProgress(r.id);
        return {
          id: r.id,
          status: r.status,
          label: r.label ?? null,
          agentId: r.agentId,
          subagentType: r.subagentType ?? null,
          prompt: r.prompt ?? null,
          result: r.result ?? null,
          durationMs: r.durationMs ?? null,
          totalTokens: progress?.totalTokens ?? r.totalTokens ?? null,
          toolUseCount: progress?.toolUseCount ?? null,
          lastToolName:
            r.status === 'running' || r.status === 'queued' ? (progress?.lastToolName ?? null) : null,
          lastToolArgs:
            r.status === 'running' || r.status === 'queued' ? (progress?.lastToolArgs ?? null) : null,
          currentActivity:
            r.status === 'running' || r.status === 'queued'
              ? (progress?.currentActivity ?? null)
              : null,
        };
      }),
      batch,
    };
  };
}


/**
 * True when `project` is `null` (clearing the pin) or names a currently
 * configured GROUPED server for the tenant — the same well-formedness a
 * thread's project pin must satisfy to ever narrow MCP scoping (see
 * `resolveScopedServerNames` in routes/mcp-apps.ts). A pin naming an
 * ungrouped or nonexistent server would either do nothing (ungrouped
 * servers pass every scoping check regardless of pin) or, worse, read as
 * garbage forever — so POST /api/project rejects it up front instead of
 * silently persisting it. Exported for testing at this seam: there is no
 * HTTP harness in this repo (see mcp-apps-scoping.test.ts for the sibling
 * convention).
 */
export async function isValidProjectPin(
  tenantId: string,
  project: string | null,
): Promise<boolean> {
  if (project == null) return true;
  const groups = await listMcpServerGroups(tenantId);
  return groups[project] != null;
}

export function registerThreadsRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // Tasks: list/get for the UI task panel.
  app.get('/api/tasks', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { threadId, batchIds: batchIdsRaw } = req.query as {
      threadId?: string;
      batchIds?: string;
    };
    if (!threadId) return { tasks: [] };
    try {
      return await deps.readTaskSnapshot(threadId, ctx, batchIdsRaw);
    } catch (err) {
      req.log.warn({ err, threadId }, 'tasks read failed');
      if (isDatastoreFailure(err)) {
        return reply.status(503).send({ tasks: [], error: 'datastore_unavailable' });
      }
      throw err;
    }
  });

  /** Stop a single subagent task (status-bar / TaskStop parity with Claude Code). */
  app.post('/api/tasks/:taskId/stop', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { taskId } = req.params as { taskId: string };
    try {
      const row = await getTaskRow(taskId);
      if (!row) return reply.status(404).send({ ok: false, status: 'unknown' });
      if (row.parentThreadId) {
        const owned = await resolveThreadForRead(row.parentThreadId, ctx);
        if (!owned) return reply.status(403).send({ error: 'forbidden' });
      }
      const result = await cancelSubagentTask(taskId, deps.queue);
      return result;
    } catch (err) {
      req.log.warn({ err, taskId }, 'task stop failed');
      if (isDatastoreFailure(err)) {
        return reply.status(503).send({ ok: false, error: 'datastore_unavailable' });
      }
      throw err;
    }
  });

  app.get('/api/tasks/events', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { threadId, batchIds: batchIdsRaw } = req.query as {
      threadId?: string;
      batchIds?: string;
    };
    if (!threadId) return reply.status(400).send({ error: 'threadId_required' });

    try {
      const row = await resolveThreadForRead(threadId, ctx);
      if (!row) return reply.status(404).send({ error: 'thread_not_found' });
    } catch (err) {
      req.log.warn({ err, threadId }, 'tasks events ownership check failed');
      if (isDatastoreFailure(err)) {
        return reply.status(503).send({ error: 'datastore_unavailable' });
      }
      throw err;
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let closed = false;
    let sendChain = Promise.resolve();

    const sendEvent = (eventName: TaskEvent['kind'], data: unknown) => {
      if (closed || reply.raw.destroyed) return;
      reply.raw.write(`event: ${eventName}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const sendSnapshot = (kind: TaskEvent['kind'] = 'task.snapshot') => {
      sendChain = sendChain.then(async () => {
        if (closed) return;
        try {
          const snapshot = await deps.readTaskSnapshot(threadId, ctx, batchIdsRaw);
          sendEvent(kind, snapshot);
        } catch (err) {
          req.log.warn({ err, threadId }, 'tasks events snapshot failed');
          sendEvent(kind, { tasks: [], error: 'snapshot_failed' });
        }
      });
    };

    const unsubscribe = deps.subscribeTaskEvents(threadId, (event) => {
      sendSnapshot(event.kind);
    });

    req.raw.on('close', () => {
      closed = true;
      unsubscribe();
    });

    reply.raw.write(': connected\n\n');
    sendSnapshot('task.snapshot');
  });

  app.get('/api/todos', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { threadId } = req.query as { threadId?: string };
    if (!threadId) return { todos: [] };
    try {
      const row = await resolveThreadForRead(threadId, ctx);
      return { todos: row?.todos ?? [] };
    } catch (err) {
      req.log.warn({ err, threadId }, 'todos read failed');
      if (isDatastoreFailure(err)) {
        return reply.status(503).send({ todos: [], error: 'datastore_unavailable' });
      }
      throw err;
    }
  });

  app.get('/api/threads', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    try {
      const threads = await listThreadsForResource(
        ctx.tenantId,
        ctx.userId,
        deps.runtime.memory,
      );
      return { threads };
    } catch (err) {
      req.log.warn({ err }, 'thread list failed');
      if (isDatastoreFailure(err)) {
        return reply.status(503).send({ threads: [], error: 'datastore_unavailable' });
      }
      throw err;
    }
  });

  app.get('/api/threads/activity', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    try {
      const activity = await listThreadActivity(ctx.tenantId, ctx.userId, deps.runtime.memory);
      return { activity };
    } catch (err) {
      req.log.warn({ err }, 'thread activity read failed');
      if (isDatastoreFailure(err)) {
        return reply.status(503).send({ activity: {}, error: 'datastore_unavailable' });
      }
      throw err;
    }
  });

  app.get('/api/threads/:threadId', async (req, reply) => {
    const { threadId } = req.params as { threadId: string };
    const ctx = await deps.resolveContext(req.headers);
    const state = await getThreadState(threadId);
    if (state) {
      try {
        await requireThreadOwnership(threadId, ctx);
      } catch (err) {
        if (deps.isForbiddenError(err)) return reply.status(403).send({ error: 'forbidden' });
        throw err;
      }
    }
    if (!state) {
      return {
        remoteId: threadId,
        status: 'regular' as const,
      };
    }
    return {
      remoteId: state.threadId,
      title: state.title ?? undefined,
      lastMessageAt: state.updatedAt,
      status: 'regular' as const,
    };
  });

  app.post('/api/threads/:threadId/initialize', async (req) => {
    const { threadId } = req.params as { threadId: string };
    return { ok: true, remoteId: threadId };
  });

  app.patch('/api/threads/:threadId/title', async (req) => {
    const { threadId } = req.params as { threadId: string };
    const body = req.body as { title?: string };
    const ctx = await deps.resolveContext(req.headers);
    await ensureThreadState({ threadId, tenantId: ctx.tenantId, resourceId: ctx.userId });
    if (typeof body.title === 'string') {
      await setThreadTitle(threadId, body.title);
    }
    return { ok: true, title: body.title ?? null };
  });

  app.post('/api/threads/:threadId/generate-title', async (req) => {
    const { threadId } = req.params as { threadId: string };
    const body = (req.body ?? {}) as { messages?: unknown[] };
    const ctx = await deps.resolveContext(req.headers);
    await ensureThreadState({ threadId, tenantId: ctx.tenantId, resourceId: ctx.userId });
    const existing = await getThreadState(threadId);
    if (existing?.title?.trim()) {
      return { title: existing.title };
    }
    const messages = body.messages ?? [];
    const title = await generateThreadTitle(messages);
    await setThreadTitle(threadId, title);
    return { title };
  });

  app.delete('/api/threads/:threadId', async (req, reply) => {
    const { threadId } = req.params as { threadId: string };
    const ctx = await deps.resolveContext(req.headers);
    const row = await resolveThreadForRead(threadId, ctx);
    if (row) {
      await deleteThreadState(threadId, deps.runtime.memory);
    }
    return { ok: true };
  });

  app.get('/api/threads/:threadId/state', async (req) => {
    const { threadId } = req.params as { threadId: string };
    const ctx = await deps.resolveContext(req.headers);
    // Read-only: do not ensureThreadState here — that would create empty
    // 「新对话」rows when the client probes a local __LOCALID_* before first send.
    const row = await resolveThreadForRead(threadId, ctx);
    if (!row) {
      return { state: null };
    }
    return { state: row };
  });

  app.get('/api/threads/:threadId/messages', async (req, reply) => {
    const { threadId } = req.params as { threadId: string };
    const ctx = await deps.resolveContext(req.headers);
    const row = await resolveThreadForRead(threadId, ctx);
    if (!row) {
      return { messages: [] };
    }
    try {
      const recalled = await recallOrEmpty(deps.runtime.memory, {
        threadId,
        resourceId: row.resourceId,
        perPage: false,
      });
      return { messages: mastraMessagesToUi(recalled.messages ?? []) };
    } catch (err) {
      req.log.warn({ err, threadId }, 'memory recall failed for thread messages');
      if (isMemoryStoreFailure(err)) {
        return reply.status(503).send({ ok: false, error: 'memory_unavailable' });
      }
      return reply.status(500).send({ ok: false, error: 'memory_recall_failed' });
    }
  });

  /** Client-authoritative transcript sync (claude-code style recordTranscript). */
  app.post('/api/threads/:threadId/messages', async (req, reply) => {
    const { threadId } = req.params as { threadId: string };
    const body = (req.body ?? {}) as {
      messages?: UiMessage[];
      forceReplace?: boolean;
    };
    const clientMessages = body.messages ?? [];
    if (clientMessages.length === 0) {
      return reply.status(400).send({ ok: false, error: 'messages required' });
    }

    const ctx = await deps.resolveContext(req.headers);
    const row = await resolveThreadForRead(threadId, ctx);
    if (!row) {
      return reply.status(404).send({ ok: false, error: 'thread not found' });
    }

    const identity = {
      threadId,
      tenantId: row.tenantId,
      resourceId: row.resourceId,
    };

    const replaced = await syncThreadMessagesFromClient({
      memory: deps.runtime.memory,
      identity,
      clientMessages,
      forceReplace: body.forceReplace ?? true,
    });

    return { ok: true, replaced };
  });

  app.get('/api/plan-mode', async (req) => {
    const { threadId } = req.query as { threadId?: string };
    if (!threadId) return { planMode: false };
    const ctx = await deps.resolveContext(req.headers);
    const row = await resolveThreadForRead(threadId, ctx);
    return { planMode: row?.planMode ?? false };
  });

  app.post('/api/plan-mode', async (req) => {
    const body = req.body as { threadId?: string; planMode?: boolean };
    const ctx = await deps.resolveContext(req.headers);
    if (body.threadId != null && body.planMode != null) {
      await ensureThreadState({
        threadId: body.threadId,
        tenantId: ctx.tenantId,
        resourceId: ctx.userId,
      });
      await setThreadPlanModeDb(body.threadId, body.planMode);
      setThreadPlanMode(body.threadId, body.planMode);
    }
    const state = body.threadId ? await getThreadState(body.threadId) : null;
    return { ok: true, planMode: state?.planMode ?? false };
  });

  app.get('/api/project', async (req) => {
    const { threadId } = req.query as { threadId?: string };
    if (!threadId) return { project: null };
    const ctx = await deps.resolveContext(req.headers);
    const row = await resolveThreadForRead(threadId, ctx);
    return { project: row?.project ?? null };
  });

  /** Bulk thread→project map for the Projects sidebar (grouping threads by pin). */
  app.get('/api/projects/threads', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    return listThreadProjects(ctx.tenantId);
  });

  app.post('/api/project', async (req, reply) => {
    const body = req.body as { threadId?: string; project?: string | null };
    const ctx = await deps.resolveContext(req.headers);
    if (body.threadId != null && body.project !== undefined) {
      if (!(await isValidProjectPin(ctx.tenantId, body.project))) {
        return reply
          .status(400)
          .send({ ok: false, error: 'project is not a configured group member' });
      }
      const existing = await ensureThreadState({
        threadId: body.threadId,
        tenantId: ctx.tenantId,
        resourceId: ctx.userId,
      });
      // Move-boundary bookkeeping (audit fix #3): stamps movedFrom/movedAt
      // when this user-directed change leaves a previously non-null pin —
      // see setProjectWithMoveTracking's docstring for why this is scoped to
      // this route rather than folded into the generic setProject.
      await setProjectWithMoveTracking(body.threadId, existing.project, body.project);
    }
    const state = body.threadId ? await getThreadState(body.threadId) : null;
    return { ok: true, project: state?.project ?? null };
  });

  app.post('/api/compact', async (req) => {
    const query = req.query as { threadId?: string; model?: string; instructions?: string };
    const body = (req.body ?? {}) as { instructions?: string };
    const { threadId } = query;
    if (!threadId) return { ok: false, error: 'threadId required' };
    try {
      const ctx = await deps.resolveContext(req.headers);
      await applyTenantModelSettings(ctx.tenantId);
      const threadRow = await ensureThreadState({
        threadId,
        tenantId: ctx.tenantId,
        resourceId: ctx.userId,
      });
      const identity = {
        threadId,
        tenantId: threadRow.tenantId,
        resourceId: threadRow.resourceId,
      };

      await stopChatStream({ threadId }).catch(() => undefined);

      const { getHookBus } = await import('../hooks-service.js');
      const hookBus = getHookBus(ctx.tenantId);
      await hookBus.emit('PreCompact', { trigger: 'manual', thread_id: threadId }, { threadId });

      const recalled = await recallOrEmpty(deps.runtime.memory, {
        threadId,
        resourceId: threadRow.resourceId,
        perPage: false,
      });
      const stored = recalled?.messages ?? [];
      const modelKey = (query.model ?? 'default') as ModelKey;
      const instructions = (body.instructions ?? query.instructions)?.trim() || undefined;
      const compressor = new ContextCompression({
        summarizer: buildSummarizer(modelKey, { focusInstructions: instructions }),
        force: true,
      });
      const compacted = await compressor.processInput({ messages: stored });
      const uiMessages = mastraMessagesToUi(
        compacted as Array<{ id?: string; role?: string; content?: { parts?: unknown[] } }>,
      );

      await syncThreadMessagesFromClient({
        memory: deps.runtime.memory,
        identity,
        clientMessages: uiMessages,
        forceReplace: true,
      });

      runPostCompactCleanup();
      await hookBus.emit('PostCompact', { trigger: 'manual', thread_id: threadId }, { threadId });

      return {
        ok: true,
        before: stored.length,
        after: compacted.length,
        messages: uiMessages,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });


}
