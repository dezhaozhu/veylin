import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { toAISdkStream } from '@mastra/ai-sdk';
import { RequestContext } from '@mastra/core/di';
import {
  DEFAULT_AGENT_ID,
  getModelConfig,
  buildLocaleBlock,
  buildSummarizer,
  buildAgentOrchestrationBlock,
  buildCoordinatorOrchestrationBlock,
  isCoordinatorMode,
  type ModelKey,
} from '@veylin/runtime';
import { setThreadPlanMode } from '@veylin/tools';
import {
  createUiStreamRepairState,
  formatAgentStreamError,
  repairUiStreamChunk,
} from '../ui-stream-repair.js';
import { recordAudit } from '../audit.js';
import {
  buildAttachedBrowserBlock,
  lastUserText,
  modelSupportsImages,
  parseChatBody,
  toAgentMessages,
  buildWorkspacePanelHintBlock,
} from '../chat.js';
import { listDispatchableCustomAgentIds } from '../agent-task-runner.js';
import { scheduleDreamConsolidation } from '../dream-service.js';
import { buildTableContextBlock } from '../table-store.js';
import { scheduleEditGuidanceBlock } from '../schedule-edit.js';
import {
  activateSkill,
  ensureThreadState,
  ephemeralThreadState,
  getSkillMemoryBlock,
  getThreadState,
  type ThreadStateRow,
  setPlanMode as setThreadPlanModeDb,
  setTodos as setThreadTodosDb,
  syncWorkingMemory,
  restoreTodosFromHistoryIfEmpty,
  requireThreadOwnership,
  resolveThreadForRead,
  touchThreadActivity,
} from '../thread-state.js';
import { buildReminderBlock } from '../reminders.js';
import { buildPlanModeBlock } from '../plan-mode-reminder.js';
import { buildChatSystemBlocks } from '../chat-system-blocks.js';
import { isMemoryStoreFailure, syncThreadMessagesFromClient } from '../thread-sync.js';
import { isDatastoreFailure, withDatastoreFallback } from '../store-errors.js';
import {
  mastraMessagesToAgentContext,
  mergeAgentContextMessages,
  type UiMessage,
} from '../message-sync.js';
import { filterExternalToolsets } from '../toolsets.js';
import {
  bindActiveStream,
  captureSseToResumable,
  clearActiveStream,
  createRunAbortController,
  getActiveStreamId,
  isStreamCancelled,
  mergeResumableStreamHeaders,
  resolveResumeCursor,
  resumeStreamResponse,
  stopChatStream,
  unregisterRunAbort,
} from '../resumable-chat-stream.js';
import { refreshAgentPackages, requireAgent } from '../agent-packages-sync.js';
import {
  listMergedSkills,
  resolveSkillContent,
  buildSkillsCatalogBlock,
} from '../skills-store.js';
import {
  listRules,
  buildRulesMemoryBlock,
} from '../rules-store.js';
import { listActiveMcpServerNames } from '../mcp-store.js';
import { applyTenantModelSettings } from '../model-settings-store.js';
import { buildKnowledgeContextBlock } from '../rag-store.js';
import type { ServerDeps } from './types.js';

/**
 * SSE keepalive cadence. Must stay below the client liveness timeout
 * (LIVENESS_TIMEOUT_MS = 45s) so long synchronous tool turns never look "dead".
 */
const SSE_KEEPALIVE_INTERVAL_MS = 15_000;

export function registerChatRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.post('/api/resume', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    await applyTenantModelSettings(ctx.tenantId);
    const body = req.body as { runId?: string; resumeData?: unknown; agentId?: string };
    const agent = deps.runtime.getAgent(body.agentId ?? DEFAULT_AGENT_ID) as unknown as {
      resumeStream?: (data: unknown, opts: { runId: string }) => Promise<unknown>;
    };
    if (!body.runId || !agent?.resumeStream) {
      return { ok: false, error: 'runId and resumeStream required' };
    }
    const stream = await agent.resumeStream(body.resumeData, { runId: body.runId });
    return { ok: true, stream: stream != null };
  });

  app.post('/api/chat', async (req, reply) => {
    const body = parseChatBody(req.body);
    const messages = body.messages ?? [];
    if (messages.length === 0) {
      return reply.status(400).send({ error: 'messages required' });
    }

    const ctx = await deps.resolveContext(req.headers);
    await applyTenantModelSettings(ctx.tenantId);
    await deps.ensureMcpForTenant(ctx.tenantId);
    const threadId = body.id ?? body.threadId ?? `thread-${ctx.userId}`;
    const agentId = body.agentId ?? DEFAULT_AGENT_ID;
    const identity = {
      threadId,
      tenantId: ctx.tenantId,
      resourceId: ctx.userId,
    };

    let threadRow: ThreadStateRow;
    let threadStoreOk = true;
    try {
      threadRow = await ensureThreadState(identity);
      await touchThreadActivity(threadId);
    } catch (err) {
      if (!isDatastoreFailure(err)) throw err;
      threadStoreOk = false;
      threadRow = ephemeralThreadState(identity);
      app.log.warn({ err, threadId }, 'thread state store failed; continuing chat ephemerally');
    }
    await stopChatStream({ threadId }).catch(() => undefined);
    if (threadStoreOk) {
      await withDatastoreFallback(
        () => restoreTodosFromHistoryIfEmpty(threadId, messages as never),
        undefined,
      );
    }

    let threadRowState = threadRow;
    if (threadStoreOk && body.planMode === true) {
      await setThreadPlanModeDb(threadId, true);
      setThreadPlanMode(threadId, true);
      threadRowState = (await getThreadState(threadId)) ?? threadRow;
    } else if (threadStoreOk && body.planMode === false) {
      await setThreadPlanModeDb(threadId, false);
      setThreadPlanMode(threadId, false);
      threadRowState = (await getThreadState(threadId)) ?? threadRow;
    } else if (body.planMode === true) {
      setThreadPlanMode(threadId, true);
      threadRowState = { ...threadRow, planMode: true };
    } else if (body.planMode === false) {
      setThreadPlanMode(threadId, false);
      threadRowState = { ...threadRow, planMode: false };
    }

    const planMode = body.planMode === true || (threadRowState?.planMode ?? false);

    await refreshAgentPackages(deps.runtime);
    const agent = requireAgent(deps.runtime, agentId);
    const modelKey = (body.model ?? 'default') as ModelKey;
    const modelConfig = getModelConfig(modelKey);
    if (!modelConfig.apiKey.trim()) {
      return reply.status(400).send({
        error: 'model_not_configured',
        message: 'Model API key is not configured. Open Settings -> Models and add your own API key.',
      });
    }

    const mcpAgentId = agentId;
    const declaredMcp = deps.runtime.definitions.get(mcpAgentId)?.definition.mcpServers ?? [];
    const mcpEnabled = body.mcpEnabled as Record<string, boolean> | undefined;
    const tenantActiveMcp = await withDatastoreFallback(
      () => listActiveMcpServerNames(ctx.tenantId, declaredMcp),
      [] as string[],
    );
    const activeMcp = tenantActiveMcp.filter(
      (server) => mcpEnabled == null || mcpEnabled[server] !== false,
    );

    const mergedSkills = await withDatastoreFallback(
      () => listMergedSkills(deps.runtime, ctx.tenantId, agentId),
      [],
    );
    const enabledSkillNames = mergedSkills.filter((s) => s.enabled).map((s) => s.name);

    await recordAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      threadId,
      action: 'chat.request',
      detail: { agentId, model: body.model, planMode },
    });

    const toolQuery = body.toolQuery ?? lastUserText(messages);
    const requestContext = new RequestContext();
    requestContext.set('toolQuery', toolQuery);
    requestContext.set('planMode', planMode);
    requestContext.set('tenantId', ctx.tenantId);
    requestContext.set('userId', ctx.userId);
    requestContext.set('threadId', threadId);
    requestContext.set('parentAgentId', agentId);
    requestContext.set('publicBaseUrl', `${req.protocol}://${req.headers.host ?? '127.0.0.1:8787'}`);
    requestContext.set('discoveredToolIds', []);
    requestContext.set('mcpToolNames', deps.getMcpToolIndex());
    requestContext.set('persistTodos', async (todos: import('@veylin/tools').TodoItem[]) => {
      await ensureThreadState(identity);
      return setThreadTodosDb(threadId, todos);
    });
    requestContext.set('setPlanMode', async (on: boolean) => {
      await setThreadPlanModeDb(threadId, on);
      setThreadPlanMode(threadId, on);
      requestContext.set('planMode', on);
    });
    requestContext.set('onSkillActivated', async ({ name }: { name: string; content: string }) => {
      const content = await resolveSkillContent(deps.runtime, ctx.tenantId, agentId, name);
      if (!content) return;
      const skills = await activateSkill(threadId, name, content);
      await syncWorkingMemory(deps.runtime.memory, identity, skills, threadRowState?.workingMemory ?? null);
    });
    requestContext.set('enabledSkillNames', enabledSkillNames);
    requestContext.set(
      'resolveSkillByName',
      async (name: string) => resolveSkillContent(deps.runtime, ctx.tenantId, agentId, name),
    );
    if (body.model) requestContext.set('model', body.model);

    if (body.pendingSkill) {
      const content = await resolveSkillContent(
        deps.runtime,
        ctx.tenantId,
        agentId,
        body.pendingSkill,
      );
      if (content) {
        const skills = await activateSkill(threadId, body.pendingSkill, content);
        threadRowState = {
          ...(threadRowState ?? (await ensureThreadState(identity))),
          activatedSkills: skills,
        };
        await syncWorkingMemory(
          deps.runtime.memory,
          identity,
          skills,
          threadRowState.workingMemory ?? null,
        );
      }
    }

    let skillBlock = getSkillMemoryBlock(threadRowState?.activatedSkills ?? {});

    let useThreadMemory = threadStoreOk;
    try {
      await syncThreadMessagesFromClient({
        memory: deps.runtime.memory,
        identity,
        clientMessages: messages as never,
        forceReplace: body.forceReplace,
      });
    } catch (err) {
      if (isMemoryStoreFailure(err)) {
        useThreadMemory = false;
        app.log.warn(
          { err, threadId },
          'message sync failed (memory store); continuing chat without thread memory',
        );
      } else {
        throw err;
      }
    }

    // Per-agent MCP: only expose declared servers; none when undeclared.
    const agentMcp =
      planMode
        ? {}
        : activeMcp.length > 0
          ? Object.fromEntries(
              Object.entries(deps.getMcpToolsets()).filter(([server]) => activeMcp.includes(server)),
            )
          : {};

    const effectiveModel = body.model ?? deps.runtime.definitions.get(agentId)?.definition.model;
    let agentInputMessages = messages as UiMessage[];
    if (useThreadMemory) {
      try {
        const recalled = await deps.runtime.memory.recall({
          threadId,
          resourceId: ctx.userId,
          perPage: false,
        });
        const recalledForAgent = mastraMessagesToAgentContext(recalled.messages ?? []);
        agentInputMessages = mergeAgentContextMessages(
          messages as UiMessage[],
          recalledForAgent,
        );
      } catch (err) {
        app.log.warn({ err, threadId }, 'agent context merge failed; using client messages');
      }
    }
    let agentMessages = await toAgentMessages(
      agentInputMessages as Parameters<typeof toAgentMessages>[0],
      modelSupportsImages(effectiveModel),
    );

    const rules = await withDatastoreFallback(
      () => listRules(ctx.tenantId, ctx.userId, agentId),
      [],
    );
    const rulesBlock = buildRulesMemoryBlock(rules, lastUserText(messages));
    const skillsCatalog = buildSkillsCatalogBlock(mergedSkills);
    const reminderBlock = buildReminderBlock({
      todos: threadRowState?.todos ?? [],
      lastUserText: lastUserText(messages),
      todosUpdatedAt: threadRowState?.updatedAt,
    });
    const planModeBlock = planMode ? buildPlanModeBlock() : '';
    // Live workspace awareness (table + knowledge base + right-panel focus).
    const tableBlockBase = planMode ? '' : buildTableContextBlock();
    const editGuidance = planMode ? '' : scheduleEditGuidanceBlock(deps.getMcpToolsets);
    const tableBlock = [tableBlockBase, editGuidance].filter(Boolean).join('\n\n');
    const knowledgeBlock = planMode
      ? ''
      : await withDatastoreFallback(() => buildKnowledgeContextBlock(ctx.tenantId), '');
    const workspacePanelBlock = planMode
      ? ''
      : buildWorkspacePanelHintBlock(body.workspacePanel);
    const localeBlock = buildLocaleBlock(body.locale);
    const attachedBrowserBlock = buildAttachedBrowserBlock(body.attachedBrowser);
    const agentDefForBlocks = deps.runtime.definitions.get(agentId)?.definition;
    const fullToolset = agentDefForBlocks?.fullToolset === true;
    const coordinatorMode = isCoordinatorMode() && !planMode && fullToolset;
    const orchestrationBlock =
      !planMode && fullToolset
        ? coordinatorMode
          ? buildCoordinatorOrchestrationBlock(listDispatchableCustomAgentIds(deps.runtime, agentId))
          : buildAgentOrchestrationBlock(listDispatchableCustomAgentIds(deps.runtime, agentId))
        : '';
    const systemBlocks = await buildChatSystemBlocks({
      skillsCatalog,
      skillBlock,
      rulesBlock,
      planModeBlock,
      tableBlock,
      knowledgeBlock,
      workspacePanelBlock,
      reminderBlock,
      orchestrationBlock,
      localeBlock,
      attachedBrowserBlock,
    });
    if (systemBlocks) {
      agentMessages = [{ role: 'system', content: systemBlocks } as never, ...agentMessages];
    }

    const discoveredIds = (requestContext.get('discoveredToolIds') as string[]) ?? [];
    const agentDef = deps.runtime.definitions.get(agentId)?.definition;
    const declaredBuiltinTools = agentDef?.tools ?? [];
    const activeToolsets = planMode
      ? {}
      : coordinatorMode
        ? { agent: deps.getTaskToolset().agent }
        : fullToolset
          ? {
              ...agentMcp,
              ...deps.getTaskToolset(),
            }
          : {
              ...filterExternalToolsets(
                agentMcp,
                deps.getTaskToolset(),
                discoveredIds,
                declaredMcp,
                declaredBuiltinTools,
              ),
              ...(deps.getTaskToolset().table ? { table: deps.getTaskToolset().table } : {}),
              ...(deps.getTaskToolset().knowledge ? { knowledge: deps.getTaskToolset().knowledge } : {}),
            };
    const streamId = crypto.randomUUID();
    const runAbort = createRunAbortController(streamId);
    requestContext.set('runAbortSignal', runAbort.signal);

    const stream = await agent.stream(agentMessages as never, {
      maxSteps: 25,
      ...(useThreadMemory ? { memory: { thread: threadId, resource: ctx.userId } } : {}),
      requestContext,
      toolsets: activeToolsets,
    } as never);

    await bindActiveStream(threadId, streamId);
    const cancelPoll = setInterval(() => {
      void isStreamCancelled(streamId)
        .then((cancelled) => {
          if (cancelled) runAbort.abort();
        })
        .catch((err) => {
          app.log.warn({ err, streamId }, 'cancel poll failed');
        });
    }, 300);

    const from = 'agent';
    const uiMessageStream = createUIMessageStream({
      originalMessages: messages as never,
      onFinish: () => {
        clearInterval(cancelPoll);
        unregisterRunAbort(streamId);
        void clearActiveStream(threadId).catch((err) => {
          app.log.warn({ err, threadId }, 'clearActiveStream failed');
        });
        scheduleDreamConsolidation(deps.runtime, identity);
      },
      execute: async ({ writer }) => {
        const streamRepair = createUiStreamRepairState();
        // Synchronous subagent tools (the `task` tool) can hold the model turn for
        // minutes without emitting any SSE bytes. Emit a transient keepalive every
        // 15s (well under the client's 45s liveness timeout) so the connection is
        // not torn down + reconnected. The part is transient (never added to message
        // state) and flows through the same tee, so the resumable cursor stays 1:1.
        const keepAlive = setInterval(() => {
          if (runAbort.signal.aborted) return;
          try {
            writer.write({
              type: 'data-keepalive',
              data: { t: Date.now() },
              transient: true,
            } as never);
          } catch {
            /* writer already closed */
          }
        }, SSE_KEEPALIVE_INTERVAL_MS);
        try {
          for await (const part of toAISdkStream(stream as never, {
            from,
            version: 'v6',
            sendReasoning: true,
          } as never)) {
            if (runAbort.signal.aborted) break;
            for (const repaired of repairUiStreamChunk(part as never, streamRepair)) {
              writer.write(repaired as never);
            }
          }
        } catch (err) {
          req.log.warn({ err, threadId }, 'agent stream failed');
          writer.write({
            type: 'error',
            errorText: formatAgentStreamError(err),
          } as never);
        } finally {
          clearInterval(keepAlive);
          clearInterval(cancelPoll);
        }
      },
    });

    const response = createUIMessageStreamResponse({
      stream: uiMessageStream,
      consumeSseStream: ({ stream: sseBranch }) => {
        captureSseToResumable(streamId, sseBranch);
      },
    });

    reply.hijack();
    reply.raw.writeHead(
      response.status,
      mergeResumableStreamHeaders(
        Object.fromEntries(response.headers),
        streamId,
      ),
    );
    if (response.body) {
      Readable.fromWeb(response.body as never).pipe(reply.raw);
    } else {
      reply.raw.end();
    }
  });

  /** AI SDK + agent-style stream resume by thread id. */
  app.get('/api/chat/:threadId/stream', async (req, reply) => {
    const { threadId } = req.params as { threadId: string };
    const ctx = await deps.resolveContext(req.headers);
    const row = await resolveThreadForRead(threadId, ctx);
    if (!row) {
      return reply.status(204).send();
    }
    const streamId = await getActiveStreamId(threadId);
    if (!streamId) {
      return reply.status(204).send();
    }

    const query = req.query as { from_sequence_num?: string };
    const lastEventId = req.headers['last-event-id'];
    const cursor = resolveResumeCursor(
      typeof lastEventId === 'string' ? lastEventId : undefined,
      query.from_sequence_num,
    );

    const resumed = await resumeStreamResponse(streamId, cursor);
    if (!resumed?.body) {
      return reply.status(204).send();
    }

    reply.hijack();
    reply.raw.writeHead(resumed.status, Object.fromEntries(resumed.headers));
    Readable.fromWeb(resumed.body as never).pipe(reply.raw);
  });

  /** Explicit stop: cancel generation and clear resumable stream (not a disconnect). */
  app.post('/api/chat/:threadId/stop', async (req, reply) => {
    const { threadId } = req.params as { threadId: string };
    const ctx = await deps.resolveContext(req.headers);
    try {
      const state = await getThreadState(threadId);
      if (state) {
        try {
          await requireThreadOwnership(threadId, ctx);
        } catch (err) {
          if (deps.isForbiddenError(err)) return reply.status(403).send({ error: 'forbidden' });
          throw err;
        }
      }
    } catch (err) {
      if (!isDatastoreFailure(err)) throw err;
      req.log.warn({ err, threadId }, 'thread state read failed during stop; continuing');
    }
    const body = (req.body ?? {}) as { activeStreamId?: string };
    const result = await stopChatStream({
      threadId,
      activeStreamId: body.activeStreamId,
    });
    return result;
  });

  /** Resume by resumable stream id (AssistantChatTransport / Last-Event-ID). */
  app.get('/api/chat/streams/:streamId', async (req, reply) => {
    const { streamId } = req.params as { streamId: string };
    const query = req.query as { from_sequence_num?: string };
    const lastEventId = req.headers['last-event-id'];
    const cursor = resolveResumeCursor(
      typeof lastEventId === 'string' ? lastEventId : undefined,
      query.from_sequence_num,
    );

    const resumed = await resumeStreamResponse(streamId, cursor);
    if (!resumed?.body) {
      // 204 = nothing to resume (finished / expired / other instance) — not an error.
      return reply.status(204).send();
    }

    reply.hijack();
    reply.raw.writeHead(resumed.status, Object.fromEntries(resumed.headers));
    Readable.fromWeb(resumed.body as never).pipe(reply.raw);
  });

  // Approval resume seam: the frontend posts the decision for a suspended run.
  app.post('/api/approve', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    await applyTenantModelSettings(ctx.tenantId);
    const body = req.body as { runId: string; approved: boolean; answer?: string[] };
    await refreshAgentPackages(deps.runtime);
    const agent = requireAgent(deps.runtime, DEFAULT_AGENT_ID) as unknown as {
      resume?: (runId: string, data: unknown) => Promise<unknown>;
    };
    await recordAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'approval.decision',
      detail: { runId: body.runId, approved: body.approved },
    });
    const result = await agent.resume?.(body.runId, {
      approved: body.approved,
      answer: body.answer,
    });
    return { ok: true, result: result ?? null };
  });
}
