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
  collectLangfuseAttachments,
  VEYLIN_CONTEXT_COMPACTED_KEY,
  buildContextSummarizedStreamChunk,
  buildContextUsageStreamChunk,
  normalizeContextUsage,
  type ModelKey,
  type VeylinContextCompacted,
  type VeylinContextUsage,
} from '@veylin/runtime';
import { setThreadPlanMode } from '@veylin/tools';
import { stripInterruptedAssistantTurnsForAgent, clampLoopWakeupSeconds, isGoalActive, isLoopActive, parseIntervalToSeconds, LOOP_WAKEUP_MIN_SECONDS, buildReadOnlyWorkingMemoryBlock } from '@veylin/shared';
import {
  createUiStreamRepairState,
  formatAgentStreamError,
  repairUiStreamChunk,
} from '../ui-stream-repair.js';
import { recordAudit } from '../audit.js';

import {
  buildAttachedBrowserBlock,
  buildProjectPinBlock,
  lastUserText,
  modelSupportsImages,
  parseChatBody,
  toAgentMessages,
  buildWorkspacePanelHintBlock,
} from '../chat.js';
import { listDispatchableCustomAgentIds } from '../agent-task-runner.js';
import { scheduleDreamConsolidation } from '../dream-service.js';
import { cancelThreadSubagentTasks } from '../cancel-thread-tasks.js';
import { buildTableContextBlock } from '../table-store.js';
import { buildViewer3dContextBlock } from '../viewer3d-store.js';
import { scheduleEditGuidanceBlock } from '../schedule-edit.js';
import {
  activateSkill,
  activateAndPinSkill,
  createActiveLoop,
  ensureThreadState,
  ephemeralThreadState,
  ensureThreadTitleIfMissing,
  getSkillMemoryBlock,
  getThreadState,
  refreshActivatedSkills,
  type ThreadStateRow,
  setPlanMode as setThreadPlanModeDb,
  setProject,
  setTodos as setThreadTodosDb,
  setThreadGoal,
  setThreadLoop,
  syncWorkingMemory,
  restoreTodosFromHistoryIfEmpty,
  requireThreadOwnership,
  resolveThreadForRead,
  touchThreadActivity,
} from '../thread-state.js';
import { buildReminderBlock } from '../reminders.js';
import { buildPlanModeBlock } from '../plan-mode-reminder.js';
import { buildGoalBlock, buildLoopBlock, appendPendingLoopTurnNote } from '../goal-loop-blocks.js';
import {
  evaluateGoalCondition,
  summarizeMessagesForGoalEval,
} from '../goal-evaluator.js';
import { rescheduleLoopFromState } from '../loop-scheduler.js';
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
import { markThreadChatActivity } from '../thread-activity.js';
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
import { listActiveMcpServerNames, listMcpServerGroups } from '../mcp-store.js';
import { resolveScopedMcp, filterMcpToolIndexToScopedServers } from '../mcp-scoping.js';
import { applyTenantModelSettings } from '../model-settings-store.js';
import { buildKnowledgeContextBlock } from '../rag-store.js';
import { getHookBus, reloadHooksForTenant } from '../hooks-service.js';
import { wrapToolsetsWithHooks } from '../tool-hooks.js';
import { wrapToolsetsWithAudit } from '../tool-audit.js';
import { getEnterprisePorts } from '../ports/index.js';
import type { ServerDeps } from './types.js';

/**
 * SSE keepalive cadence. Must stay below the client liveness timeout
 * (LIVENESS_TIMEOUT_MS = 45s) so long synchronous tool turns never look "dead".
 *
 * Prefer writing SSE comment frames directly to `reply.raw` so keepalive is not
 * blocked by AI SDK tee backpressure on the resumable capture branch.
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
    await reloadHooksForTenant(ctx.tenantId);
    const hookBus = getHookBus(ctx.tenantId);
    const threadId = body.id ?? body.threadId ?? `thread-${ctx.userId}`;
    const agentId = body.agentId ?? DEFAULT_AGENT_ID;
    const identity = {
      threadId,
      tenantId: ctx.tenantId,
      resourceId: ctx.userId,
    };

    let threadRow: ThreadStateRow;
    let threadStoreOk = true;
    let isNewSession = false;
    try {
      const before = await getThreadState(threadId);
      isNewSession = !before;
      threadRow = await ensureThreadState(identity);
      await touchThreadActivity(threadId);
    } catch (err) {
      if (!isDatastoreFailure(err)) throw err;
      threadStoreOk = false;
      isNewSession = true;
      threadRow = ephemeralThreadState(identity);
      app.log.warn({ err, threadId }, 'thread state store failed; continuing chat ephemerally');
    }

    await hookBus.emit(
      'SessionStart',
      { source: isNewSession ? 'startup' : 'resume', thread_id: threadId, agent_id: agentId },
      { threadId },
    );
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

    if (threadStoreOk && !threadRow.title?.trim()) {
      void ensureThreadTitleIfMissing(threadId, messages, {
        memory: deps.runtime.memory,
        resourceId: ctx.userId,
        modelKey,
      }).catch((err) => {
        app.log.warn({ err, threadId }, 'thread title generation failed');
      });
    }

    const mcpAgentId = agentId;
    const declaredMcp = deps.runtime.definitions.get(mcpAgentId)?.definition.mcpServers ?? [];
    const mcpEnabled = body.mcpEnabled as Record<string, boolean> | undefined;
    // Server truth: enabled-in-store ∩ declared-by-agent. mcpEnabled (below) is
    // client-declared and untrusted — project scoping must run against this list,
    // never the client-filtered one, or a client could evict the pinned server
    // from scoping by claiming it's disabled and force an (auto-pinned, formerly
    // persisted) re-pin. See attack test in mcp-scoping.test.ts.
    const tenantActiveMcp = await withDatastoreFallback(
      () => listActiveMcpServerNames(ctx.tenantId, declaredMcp),
      [] as string[],
    );

    // Server-side project scoping: narrow each grouped MCP server down to the
    // thread's pinned project, auto-pinning when the pin is missing or stale.
    // A group's pin winner survives regardless of mcpEnabled; every other member
    // of that group is dropped regardless of mcpEnabled too — a project switch
    // happens only via the explicit POST /api/project route (setProject).
    const mcpServerGroups = await withDatastoreFallback(
      () => listMcpServerGroups(ctx.tenantId),
      {} as Record<string, string | undefined>,
    );
    const threadProjectPin = threadRowState?.project ?? null;
    const scopedMcp = resolveScopedMcp(tenantActiveMcp, mcpServerGroups, threadProjectPin);
    // Persist the auto-pick only when the thread had no stored pin at all. When a
    // stored pin exists but named a store-disabled/removed server, the auto-pick
    // is used for this request only — never a silent rewrite of a pin the user
    // (or a prior explicit /api/project call) set.
    if (threadProjectPin == null && scopedMcp.autoPin) {
      void setProject(threadId, scopedMcp.autoPin).catch((err) => {
        app.log.warn({ err, threadId }, 'project auto-pin persist failed');
      });
    }
    const projectPin = scopedMcp.autoPin ?? threadProjectPin;
    // Ungrouped servers keep today's client mcpEnabled behavior exactly; grouped
    // survivors from scoping above are the pin winners and are exposed regardless
    // of what the client's mcpEnabled toggle claims.
    const activeMcp = scopedMcp.active.filter(
      (server) =>
        mcpServerGroups[server] != null || mcpEnabled == null || mcpEnabled[server] !== false,
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
    // Scope the tool-search index to this request's active servers too — otherwise
    // tool_search would let the model discover (and name) tools on non-pinned
    // group members or servers disabled by the client.
    requestContext.set(
      'mcpToolNames',
      filterMcpToolIndexToScopedServers(deps.getMcpToolIndex(), activeMcp),
    );
    // Subagent dispatch must see the project-pin-scoped list computed on
    // server-truth `tenantActiveMcp` (`scopedMcp.active`), never `activeMcp`
    // (which is additionally narrowed by the client's untrusted mcpEnabled
    // toggles). Baseline behavior handed a dispatched subagent its preset's
    // full declared MCP list regardless of client toggles — only the pin
    // should narrow what a subagent can reach; a client hiding a tool from
    // its own toolbar must not silently strip it from a subagent too.
    requestContext.set('scopedMcpServers', scopedMcp.active);
    requestContext.set('projectPin', projectPin);
    requestContext.set('persistTodos', async (todos: import('@veylin/tools').TodoItem[]) => {
      await ensureThreadState(identity);
      return setThreadTodosDb(threadId, todos);
    });
    requestContext.set('setPlanMode', async (on: boolean) => {
      await setThreadPlanModeDb(threadId, on);
      setThreadPlanMode(threadId, on);
      requestContext.set('planMode', on);
    });
    requestContext.set('threadLoop', threadRowState?.loop ?? null);
    requestContext.set('persistThreadLoop', async (loop: import('@veylin/shared').ThreadLoopState | null) => {
      await setThreadLoop(threadId, loop);
      requestContext.set('threadLoop', loop);
      rescheduleLoopFromState(threadId, loop);
    });
    requestContext.set(
      'startThreadLoop',
      async (args: { prompt: string; intervalSeconds?: number; interval?: string }) => {
        const state = await getThreadState(threadId);
        if (isGoalActive(state?.goal)) {
          return {
            ok: false,
            error: 'goal_active',
            message: 'Clear the active goal before starting a loop.',
          };
        }
        let intervalSeconds = args.intervalSeconds;
        if (intervalSeconds == null && args.interval) {
          intervalSeconds = parseIntervalToSeconds(args.interval) ?? undefined;
        }
        if (intervalSeconds == null || intervalSeconds < LOOP_WAKEUP_MIN_SECONDS) {
          return {
            ok: false,
            error: 'interval_required',
            message: `A clear interval of at least ${LOOP_WAKEUP_MIN_SECONDS}s is required.`,
          };
        }
        const loop = createActiveLoop({
          prompt: args.prompt,
          mode: 'fixed',
          intervalSeconds,
        });
        await setThreadLoop(threadId, loop);
        requestContext.set('threadLoop', loop);
        requestContext.set('pendingLoop', false);
        rescheduleLoopFromState(threadId, loop);
        return { ok: true, loop };
      },
    );
    requestContext.set('pendingLoop', body.pendingLoop === true && !isLoopActive(threadRowState?.loop));
    requestContext.set(
      'scheduleLoopWakeup',
      async (args: { delaySeconds?: number; stop?: boolean; reason?: string }) => {
        const state = await getThreadState(threadId);
        const loop = state?.loop;
        if (!loop || loop.status !== 'active') return { ok: false };
        if (args.stop) {
          const stopped = {
            ...loop,
            status: 'stopped' as const,
            nextWakeAt: undefined,
            stopRequested: true,
          };
          await setThreadLoop(threadId, stopped);
          requestContext.set('threadLoop', stopped);
          rescheduleLoopFromState(threadId, stopped);
          return { ok: true, stopped: true };
        }
        const delaySeconds = clampLoopWakeupSeconds(args.delaySeconds ?? 600);
        const nextWakeAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
        const next = { ...loop, nextWakeAt };
        await setThreadLoop(threadId, next);
        requestContext.set('threadLoop', next);
        rescheduleLoopFromState(threadId, next);
        return { ok: true, nextWakeAt, delaySeconds };
      },
    );
    requestContext.set('onSkillActivated', async ({ name }: { name: string; content: string }) => {
      const content = await resolveSkillContent(deps.runtime, ctx.tenantId, agentId, name);
      if (!content) return;
      const skills = await activateSkill(threadId, name, content);
      await syncWorkingMemory(deps.runtime.memory, identity, skills, threadRowState?.workingMemory ?? null);
      await hookBus.emit(
        'SkillActivated',
        { name, skill: name },
        { threadId },
      );
    });
    requestContext.set('enabledSkillNames', enabledSkillNames);
    requestContext.set(
      'resolveSkillByName',
      async (name: string) => resolveSkillContent(deps.runtime, ctx.tenantId, agentId, name),
    );
    if (body.model) requestContext.set('model', body.model);

    if (body.pendingSkill) {
      const expansion = await hookBus.emit(
        'UserPromptExpansion',
        { command: body.pendingSkill, skill: body.pendingSkill },
        { threadId },
      );
      if (expansion.decision === 'deny') {
        return reply.status(400).send({
          error: 'skill_blocked',
          message: expansion.reason ?? 'Skill expansion blocked by hook',
        });
      }
      const content = await resolveSkillContent(
        deps.runtime,
        ctx.tenantId,
        agentId,
        body.pendingSkill,
      );
      if (content) {
        const { activatedSkills: skills, pinnedSkills } = await activateAndPinSkill(
          threadId,
          body.pendingSkill,
          content,
        );
        threadRowState = {
          ...(threadRowState ?? (await ensureThreadState(identity))),
          activatedSkills: skills,
          pinnedSkills,
        };
        await syncWorkingMemory(
          deps.runtime.memory,
          identity,
          skills,
          threadRowState.workingMemory ?? null,
        );
      }
    }

    const activatedSkills = await refreshActivatedSkills(threadId, (name) =>
      resolveSkillContent(deps.runtime, ctx.tenantId, agentId, name),
    );
    let skillBlock = getSkillMemoryBlock(activatedSkills);

    let useThreadMemory = threadStoreOk;
    try {
      await syncThreadMessagesFromClient({
        memory: deps.runtime.memory,
        identity,
        clientMessages: messages as never,
        forceReplace: body.forceReplace,
      });
      if (threadStoreOk) {
        threadRowState = (await getThreadState(threadId)) ?? threadRowState;
      }
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
    // Uses the project-scoped + mcpEnabled-filtered list (activeMcp), not the raw
    // server-truth list.
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
    agentInputMessages = stripInterruptedAssistantTurnsForAgent(agentInputMessages);
    let agentMessages = await toAgentMessages(
      agentInputMessages as Parameters<typeof toAgentMessages>[0],
      modelSupportsImages(effectiveModel),
    );
    if (body.pendingLoop === true && !isLoopActive(threadRowState?.loop)) {
      agentMessages = appendPendingLoopTurnNote(agentMessages);
    }

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
    const goalBlock = buildGoalBlock(threadRowState?.goal);
    const loopBlock = buildLoopBlock(threadRowState?.loop);
    // Live workspace awareness (table + knowledge base + right-panel focus).
    const tableBlockBase = planMode ? '' : buildTableContextBlock(threadId, projectPin);
    // Thread-tied (unlike the workspace grid's own schedule-edit HTTP routes,
    // see mcp-scoping.ts's module docstring): this request already resolved
    // `mcpServerGroups` and `projectPin` above for MCP scoping, so the
    // guidance text's "is Compass connected" check agrees with the pinned
    // server rather than whatever `'compass'` would resolve to unpinned.
    const editGuidance = planMode
      ? ''
      : scheduleEditGuidanceBlock(deps.getMcpToolsets, mcpServerGroups, projectPin);
    const tableBlock = [tableBlockBase, editGuidance].filter(Boolean).join('\n\n');
    const viewer3dBlock = planMode ? '' : buildViewer3dContextBlock();
    const knowledgeBlock = planMode
      ? ''
      : await withDatastoreFallback(() => buildKnowledgeContextBlock(ctx.tenantId, threadId), '');
    const workspacePanelBlock = planMode
      ? ''
      : buildWorkspacePanelHintBlock(body.workspacePanel);
    const localeBlock = buildLocaleBlock(body.locale);
    const attachedBrowserBlock = buildAttachedBrowserBlock(body.attachedBrowser);
    const projectPinBlock = buildProjectPinBlock(projectPin, {
      movedFrom: threadRowState?.movedFrom ?? null,
      movedAt: threadRowState?.movedAt ?? null,
    });
    const workingMemoryBlock = buildReadOnlyWorkingMemoryBlock(
      threadRowState?.workingMemory ?? null,
    );
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
      goalBlock,
      loopBlock,
      tableBlock,
      viewer3dBlock,
      knowledgeBlock,
      workspacePanelBlock,
      reminderBlock,
      orchestrationBlock,
      localeBlock,
      attachedBrowserBlock,
      workingMemoryBlock,
      projectPinBlock,
    });
    if (systemBlocks) {
      agentMessages = [{ role: 'system', content: systemBlocks } as never, ...agentMessages];
    }

    const discoveredIds = (requestContext.get('discoveredToolIds') as string[]) ?? [];
    const agentDef = deps.runtime.definitions.get(agentId)?.definition;
    const declaredBuiltinTools = agentDef?.tools ?? [];
    const activeToolsetsRaw = planMode
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
              ...(deps.getTaskToolset().viewer3d ? { viewer3d: deps.getTaskToolset().viewer3d } : {}),
              ...(deps.getTaskToolset().knowledge ? { knowledge: deps.getTaskToolset().knowledge } : {}),
            };
    const filteredForBusiness = await getEnterprisePorts().businessSource.filterToolsets(
      ctx.tenantId,
      ctx.userId,
      activeToolsetsRaw,
    );
    const activeToolsets = wrapToolsetsWithAudit(
      wrapToolsetsWithHooks(filteredForBusiness, hookBus, {
        threadId,
        tenantId: ctx.tenantId,
      }),
      { threadId, tenantId: ctx.tenantId, userId: ctx.userId },
    );

    const promptSubmit = await hookBus.emit(
      'UserPromptSubmit',
      {
        prompt: lastUserText(messages),
        thread_id: threadId,
        agent_id: agentId,
      },
      { threadId },
    );
    if (promptSubmit.decision === 'deny') {
      return reply.status(400).send({
        error: 'prompt_blocked',
        message: promptSubmit.reason ?? 'Prompt blocked by hook',
      });
    }
    if (promptSubmit.additionalContext) {
      agentMessages = [
        { role: 'system', content: promptSubmit.additionalContext } as never,
        ...agentMessages,
      ];
    }

    await hookBus.emit(
      'InstructionsLoaded',
      { reason: 'session_start', thread_id: threadId },
      { threadId },
    );

    const streamId = crypto.randomUUID();
    const runAbort = createRunAbortController(streamId);
    // Thin defense for compact notice; full-answer dupes are fixed by client SSE cursor.
    let wroteCompactNotice = false;
    requestContext.set('runAbortSignal', runAbort.signal);

    const attachments = collectLangfuseAttachments(messages);
    let stream;
    try {
      // Do NOT pass `memory` into agent.stream. Mastra's SaveQueue / MessageHistory
      // append-saves a new assistant id per step (and on background-task flush)
      // without deleting prior snapshots — ask continuations then pile up and
      // concat-content shows the turn as duplicated. Thread context is already
      // recalled above; WM is injected via systemBlocks; persistence is
      // client-authoritative via syncThreadMessagesFromClient.
      stream = await agent.stream(agentMessages as never, {
        maxSteps: 25,
        abortSignal: runAbort.signal,
        requestContext,
        toolsets: activeToolsets,
        tracingOptions: {
          tags: ['chat', agentId],
          metadata: {
            sessionId: threadId,
            userId: ctx.userId,
            threadId,
            agentId,
            model: body.model ?? effectiveModel ?? 'default',
            streamId,
            ...(attachments.length > 0 ? { attachments } : {}),
          },
        },
      } as never);
    } catch (err) {
      await hookBus.emit(
        'StopFailure',
        {
          error_type: 'server_error',
          error: err instanceof Error ? err.message : String(err),
        },
        { threadId },
      );
      throw err;
    }

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
        markThreadChatActivity(threadId, 'finished');
        scheduleDreamConsolidation(deps.runtime, identity);
        void hookBus.emit('Stop', { thread_id: threadId }, { threadId });
        void hookBus.emit('PostToolBatch', { thread_id: threadId }, { threadId });
        void (async () => {
          try {
            const state = await getThreadState(threadId);
            if (isGoalActive(state?.goal) && state?.goal) {
              const summary = summarizeMessagesForGoalEval(
                messages as Array<{ role?: string; content?: unknown; parts?: unknown[] }>,
              );
              const evalResult = await evaluateGoalCondition({
                condition: state.goal.condition,
                transcriptSummary: summary,
                modelKey: (body.model as ModelKey | undefined) ?? undefined,
              });
              // Re-read: user may have cleared the goal while this turn was finishing.
              const latest = await getThreadState(threadId);
              if (!isGoalActive(latest?.goal) || !latest?.goal) {
                return;
              }
              const turnsEvaluated = latest.goal.turnsEvaluated + 1;
              if (evalResult.done) {
                await setThreadGoal(threadId, {
                  ...latest.goal,
                  status: 'achieved',
                  turnsEvaluated,
                  lastEvalReason: evalResult.reason,
                  needsContinuation: false,
                  updatedAt: new Date().toISOString(),
                });
              } else if (turnsEvaluated >= latest.goal.maxTurns) {
                await setThreadGoal(threadId, {
                  ...latest.goal,
                  status: 'max_turns',
                  turnsEvaluated,
                  lastEvalReason: evalResult.reason,
                  needsContinuation: false,
                  updatedAt: new Date().toISOString(),
                });
              } else {
                await setThreadGoal(threadId, {
                  ...latest.goal,
                  turnsEvaluated,
                  lastEvalReason: evalResult.reason,
                  needsContinuation: true,
                  updatedAt: new Date().toISOString(),
                });
              }
            } else if (isLoopActive(state?.loop) && state?.loop) {
              const loop = state.loop;
              if (loop.mode === 'fixed' && loop.intervalSeconds) {
                const nextWakeAt = new Date(
                  Date.now() + loop.intervalSeconds * 1000,
                ).toISOString();
                const next = { ...loop, nextWakeAt };
                await setThreadLoop(threadId, next);
                rescheduleLoopFromState(threadId, next);
              } else if (loop.mode === 'dynamic' && !loop.nextWakeAt && !loop.stopRequested) {
                // Default dynamic delay if agent forgot to schedule.
                const nextWakeAt = new Date(Date.now() + 600_000).toISOString();
                const next = { ...loop, nextWakeAt };
                await setThreadLoop(threadId, next);
                rescheduleLoopFromState(threadId, next);
              }
            }
          } catch (err) {
            app.log.warn({ err, threadId }, 'goal/loop onFinish failed');
          }
        })();
      },
      execute: async ({ writer }) => {
        const streamRepair = createUiStreamRepairState();
        // Client liveness watches response.body (45s). data-keepalive must travel on
        // this UI stream — reply.raw SSE comments never enter the fetch body.
        // consumeSseStream only tees encoded SSE; execute / toAISdkStream run once.
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

        const writeCompactNoticeIfNeeded = () => {
          if (wroteCompactNotice) return;
          const payload = requestContext.get(VEYLIN_CONTEXT_COMPACTED_KEY) as
            | VeylinContextCompacted
            | undefined;
          if (!payload) return;
          wroteCompactNotice = true;
          try {
            writer.write(buildContextSummarizedStreamChunk(payload) as never);
          } catch {
            /* writer already closed */
          }
        };

        // Last step only (Claude Code): do not sum multi-step input_tokens.
        let lastStepUsage: VeylinContextUsage | null = null;
        const writeContextUsageIfNeeded = (usage: VeylinContextUsage | null) => {
          if (!usage) return;
          const chunk = buildContextUsageStreamChunk(usage);
          if (!chunk) return;
          try {
            writer.write(chunk as never);
          } catch {
            /* writer already closed */
          }
        };

        try {
          for await (const part of toAISdkStream(stream as never, {
            from,
            version: 'v6',
            sendReasoning: true,
            // Mastra strips finish-step.usage from UI chunks; recover via messageMetadata
            // on finish (+ explicit data part after each step for the composer ring).
            messageMetadata: ({
              part: streamPart,
            }: {
              part: { type?: string; usage?: unknown; totalUsage?: unknown };
            }) => {
              if (streamPart.type === 'finish-step') {
                const usage = normalizeContextUsage(streamPart.usage);
                if (usage) lastStepUsage = usage;
                return undefined;
              }
              if (streamPart.type === 'finish') {
                const usage =
                  lastStepUsage ?? normalizeContextUsage(streamPart.totalUsage);
                if (usage) {
                  lastStepUsage = usage;
                  return { usage };
                }
              }
              return undefined;
            },
          } as never)) {
            if (runAbort.signal.aborted) break;
            // Input processors may finish after stream() returns; emit once when payload appears.
            writeCompactNoticeIfNeeded();
            for (const repaired of repairUiStreamChunk(part as never, streamRepair)) {
              writer.write(repaired as never);
            }
            const partType = (part as { type?: string }).type;
            if (partType === 'finish-step' || partType === 'finish') {
              writeContextUsageIfNeeded(lastStepUsage);
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

    // Socket-level comments keep proxies/load-balancers awake; they do NOT reset
    // client wrapStreamWithLiveness (that only sees response.body / data-keepalive).
    const rawKeepAlive = setInterval(() => {
      if (runAbort.signal.aborted || reply.raw.destroyed || reply.raw.writableEnded) {
        clearInterval(rawKeepAlive);
        return;
      }
      try {
        reply.raw.write(`: keepalive ${Date.now()}\n\n`);
      } catch {
        clearInterval(rawKeepAlive);
      }
    }, SSE_KEEPALIVE_INTERVAL_MS);

    const clearRawKeepAlive = () => clearInterval(rawKeepAlive);
    reply.raw.on('close', clearRawKeepAlive);
    reply.raw.on('error', clearRawKeepAlive);

    if (response.body) {
      const nodeBody = Readable.fromWeb(response.body as never);
      nodeBody.on('end', clearRawKeepAlive);
      nodeBody.on('error', clearRawKeepAlive);
      nodeBody.pipe(reply.raw);
    } else {
      clearRawKeepAlive();
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
    if (result.stopped) {
      markThreadChatActivity(threadId, 'interrupted');
    }
    // Cascade: stop parent stream also kills in-flight subagents for this thread
    // (Claude Code parent abort → child abortController).
    const cancelled = await cancelThreadSubagentTasks(threadId, deps.queue).catch((err) => {
      req.log.warn({ err, threadId }, 'cancel thread subagent tasks failed');
      return { cancelled: [] as string[] };
    });
    return { ...result, cancelledTasks: cancelled.cancelled };
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
