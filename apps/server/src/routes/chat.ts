import { recallOrEmpty } from '../memory-recall.js';
import { persistAskAnswer } from '../ask-answer-record.js';
import {
  EMPTY_TURN_NOTICE,
  isVisibleStreamPart,
  shouldReportEmptyTurn,
} from '../empty-turn-notice.js';
import { Readable } from 'node:stream';
import type { ServerResponse } from 'node:http';
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
import { stripInterruptedAssistantTurnsForAgent, stripUnansweredToolCallsForAgent, clampLoopWakeupSeconds, isGoalActive, isLoopActive, parseIntervalToSeconds, LOOP_WAKEUP_MIN_SECONDS, buildReadOnlyWorkingMemoryBlock } from '@veylin/shared';
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
  projectPinLabel,
  toAgentMessages,
  buildWorkspacePanelHintBlock,
} from '../chat.js';
import { listDispatchableCustomAgentIds } from '../agent-task-runner.js';
import { scheduleDreamConsolidation } from '../dream-service.js';
import { cancelThreadSubagentTasks } from '../cancel-thread-tasks.js';
import { buildTableContextBlock, formatProjectFilesBlock } from '../table-store.js';
import { resolveSheetScope } from '../table-tools.js';
import { formatTableEditsBlock } from '../table-edit-journal.js';
import { buildViewer3dContextBlock } from '../viewer3d-store.js';
import { scheduleEditGuidanceBlock } from '../schedule-edit.js';
import { compassGroundingBlock as buildCompassGroundingBlock } from '../compass-grounding.js';
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
  setTodos as setThreadTodosDb,
  setThreadGoal,
  setThreadLoop,
  setThreadSuspendedRun,
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
  mastraMessagesToUi,
  mergeAgentContextMessages,
  type UiMessage,
} from '../message-sync.js';
import { filterExternalToolsets } from '../toolsets.js';
import { restrictSourcelessToolset } from '../compass-sourceless.js';
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
import {
  resolveScopedMcp,
  filterMcpToolIndexToScopedServers,
  type McpToolIndexEntry,
} from '../mcp-scoping.js';
import {
  listProjects,
  resolvePinnedProjectScope,
  type PinnedProjectScope,
} from '../project-store.js';
import {
  getCompassToolIndexEntries,
  getPooledCompassToolsets,
  sceneSetKey,
  type CompassPoolDeps,
} from '../compass-pool.js';
import { compassRestBase } from '../compass-rest.js';
import { applyTenantModelSettings } from '../model-settings-store.js';
import { buildKnowledgeContextBlock } from '../rag-store.js';
import { getHookBus, reloadHooksForTenant } from '../hooks-service.js';
import { wrapToolsetsWithHooks } from '../tool-hooks.js';
import { wrapToolsetsWithAudit } from '../tool-audit.js';
import { getEnterprisePorts } from '../ports/index.js';
import {
  consumeSuspendedRun,
  observeSuspensionChunk,
  registerSuspendedRun,
  type SuspendedRunRecord,
} from '../chat-suspension-registry.js';
import type { ServerDeps } from './types.js';

/**
 * SSE keepalive cadence. Must stay below the client liveness timeout
 * (LIVENESS_TIMEOUT_MS = 45s) so long synchronous tool turns never look "dead".
 *
 * Prefer writing SSE comment frames directly to `reply.raw` so keepalive is not
 * blocked by AI SDK tee backpressure on the resumable capture branch.
 */
const SSE_KEEPALIVE_INTERVAL_MS = 15_000;

export type ChatMcpScopeResult = {
  /** Resolved project scope — deny-by-default nulls for unpinned/missing/foreign/disabled pins. */
  scope: PinnedProjectScope;
  /** The pinned project's id (provenance/display value), or null when the pin denied. */
  projectPin: string | null;
  /** Final per-request server-name list: project-scoped + mcpEnabled-filtered + pool-honest. */
  activeMcp: string[];
  /** Tool-search index scoped to `activeMcp`, pooled compass entries included. */
  mcpToolNames: McpToolIndexEntry[];
  /** Subagent dispatch allowlist (see the derivation comment inside). */
  scopedMcpServersForSubagents: string[];
  /**
   * The pooled, scene-set-bound compass toolsets (`{ [entryName]: tools }`),
   * or null when compass is not in scope this request or the pool build
   * failed. This is the ONLY way compass tools reach a chat turn.
   */
  compassOverlay: Record<string, unknown> | null;
};

/**
 * Per-request MCP scoping for the chat path (project-cognition v3).
 *
 * The thread pin is a PROJECT id. It is translated ONCE — the shared prelude,
 * `resolvePinnedProjectScope` — into the entry-level pin (`scope.entryPin`:
 * the enabled compass entry's name, or null) that the review-hardened pure
 * scoping functions operate on. Those functions (`resolveScopedMcp`,
 * `filterMcpToolIndexToScopedServers`, and `scopeServersToAllowlist` at
 * dispatch time) run UNCHANGED below; isolation moves from "which entry name
 * survives" to "which pooled connection (scene-set header) backs the compass
 * key for this request" — the overlay at the end.
 *
 * GUARANTEE PRESERVATION — the three review-hardened isolation guarantees,
 * translated but not weakened:
 * 1. mcpEnabled attack: which group member survives scoping is still decided
 *    against server-truth `tenantActiveMcp` names (with the translated
 *    `scope.entryPin`) — client-declared `mcpEnabled` never reaches
 *    `resolveScopedMcp`, so a client claiming the pinned entry is "disabled"
 *    still cannot evict it from scoping or force a re-pin. See the attack
 *    test in mcp-scoping.test.ts and the seam test in
 *    routes/project-pin-scoping.test.ts.
 * 2. Unpinned deny: the compass entry is grouped, and an unpinned thread —
 *    or a missing/foreign/disabled project pin — resolves to
 *    `entryPin = null`, so the personal-area filter below drops every
 *    grouped server exactly as before. Deny-by-default; never an auto-pin.
 * 3. Explicit-off subagent suppression: the subagent allowlist is still
 *    derived from `scopedActive`, so an explicit `mcpEnabled[member]=false`
 *    on the pinned grouped member suppresses it for subagents too, while an
 *    ungrouped member's client toggle keeps being ignored for the allowlist.
 *
 * NEW invariant closed here (plan risk #2 — pooled toolset substitution):
 * compass toolsets NEVER come from the tenant-level cache —
 * `buildMcpServerConfigs` excludes the compass group, so the tenant cache
 * cannot even contain them; the failure mode is "no tools", never "another
 * project's tools". When the compass entry survives scoping, its toolsets
 * are fetched from the compass pool for EXACTLY `scope.sources` — the pinned
 * project's scene set, which is byte-identically the connection's
 * `x-compass-source` header (`sceneSetKey`). Pool failure drops the entry
 * from `activeMcp`, the tool index, and the subagent allowlist: an honest
 * refusal, never a fallback to a differently-scoped (or headerless)
 * connection.
 */
export async function resolveChatMcpScope(
  args: {
    tenantId: string;
    /** The thread's raw pin value (a project id post-migration), or null. */
    threadProjectPin: string | null;
    /** Server-truth active server names (enabled-in-store ∩ declared-by-agent). */
    tenantActiveMcp: string[];
    mcpServerGroups: Record<string, string | undefined>;
    /** Client-declared, untrusted per-turn toggles. */
    mcpEnabled: Record<string, boolean> | undefined;
    /** Tenant-wide tool-search index (compass-less — see overlay below). */
    mcpToolIndex: McpToolIndexEntry[];
  },
  deps: {
    resolveScope?: typeof resolvePinnedProjectScope;
    getPooledToolsets?: typeof getPooledCompassToolsets;
    /** Forwarded to the real pool — lets tests stub the MCPClient factory. */
    poolDeps?: CompassPoolDeps;
  } = {},
): Promise<ChatMcpScopeResult> {
  const { tenantId, threadProjectPin, tenantActiveMcp, mcpServerGroups, mcpEnabled } = args;

  // The prelude: project id → entry-level pin, once. A datastore failure
  // reads as a denied scope (no grouped servers this turn) — the same
  // fail-closed posture as the withDatastoreFallback([]) wrappers the
  // route applies to the server-truth lists.
  let scope: PinnedProjectScope;
  try {
    scope = await (deps.resolveScope ?? resolvePinnedProjectScope)(tenantId, threadProjectPin);
  } catch {
    scope = { project: null, entryPin: null, sources: [], entry: null };
  }

  const scopedMcp = resolveScopedMcp(tenantActiveMcp, mcpServerGroups, scope.entryPin);
  // 全项目制 + 个人区 (2026-07-27): a thread whose pin resolved to no entry
  // pin — unpinned, or pinned to a missing/foreign/disabled project — gets NO
  // grouped servers, full stop: no silent auto-pin to the group's
  // alphabetical-first member, and nothing is persisted.
  // `resolveScopedMcp`'s `autoPin` computation is left untouched
  // (mcp-apps.ts's resolveScopedServerNames still calls the same pure fn
  // against a REAL pin), but this path must neither apply nor persist it for
  // a null entry pin: that's the removed "default-tenant" behavior.
  // Deny-by-default here matches routes/mcp-apps.ts's unpinned-deny for the
  // widget proxy — grouped members only ever surface once a thread's pin
  // resolves to a real, enabled project.
  const scopedActive =
    scope.entryPin == null
      ? scopedMcp.active.filter((server) => mcpServerGroups[server] == null)
      : scopedMcp.active;
  // Which scoping happens (the pin winner per group) is decided above, against
  // server-truth `tenantActiveMcp` only — mcpEnabled never reaches that decision,
  // so it can never evict the pinned server or force a re-pin (see the attack
  // test in mcp-scoping.test.ts). Whether the pin winner's tools are actually
  // exposed *for this request* is a separate question this filter answers, and
  // here mcpEnabled applies uniformly to grouped and ungrouped servers alike: a
  // grouped capability's toggle (composer-mcp-flyout.tsx renders one toggle per
  // group, writing the same mcpEnabled value to every member) is a plain on/off
  // switch, not a data-source switch — off means no tools from that pin winner
  // this turn, never a silent re-pin to a different group member.
  let activeMcp = scopedActive.filter(
    (server) => mcpEnabled == null || mcpEnabled[server] !== false,
  );
  // Subagent dispatch allowlist. Two different mcpEnabled semantics apply here,
  // and they must not be conflated:
  //  - Implicit/ungrouped filtering (the old regression): baseline behavior let
  //    an ordinary ungrouped server's client toggle leak into the subagent
  //    allowlist, silently stripping a tool from a dispatched subagent's preset
  //    just because the user hid it from their own toolbar for this chat. That
  //    stays fixed here — an ungrouped server's mcpEnabled is ignored for this
  //    allowlist, same as before.
  //  - Explicit grouped-capability off (deliberate): the flyout's one toggle
  //    per group is a plain on/off switch for that whole capability (e.g.
  //    "Compass"). A user turning it off for this turn plausibly means "no
  //    Compass tools for anything this turn triggers", subagents included —
  //    so an explicit mcpEnabled[member] === false on the *pinned* grouped
  //    member also drops it from the subagent allowlist. It never re-pins or
  //    switches to another group member (that's still decided above, against
  //    server-truth `tenantActiveMcp`, before mcpEnabled is ever consulted) —
  //    the group simply contributes nothing to this request or its subagents.
  //  - Derived from `scopedActive`, not `scopedMcp.active`, so an unpinned
  //    thread's personal-area deny is inherited here too — a dispatched
  //    subagent never gets a grouped server the parent turn itself was
  //    denied.
  let scopedMcpServersForSubagents = scopedActive.filter(
    (server) =>
      mcpServerGroups[server] == null || mcpEnabled == null || mcpEnabled[server] !== false,
  );

  // Pooled compass overlay: when the compass entry survived scoping AND the
  // client didn't toggle it off this turn, fetch the toolsets from the pool
  // for the pinned project's scene set. (Skipped entirely when mcpEnabled
  // turned the entry off — no pointless connection for a turn that exposes
  // nothing.)
  let compassOverlay: Record<string, unknown> | null = null;
  if (scope.entryPin != null && scope.entry != null && activeMcp.includes(scope.entryPin)) {
    const pooled = await (deps.getPooledToolsets ?? getPooledCompassToolsets)(
      tenantId,
      scope.entry,
      scope.sources,
      deps.poolDeps ?? {},
    );
    if (pooled != null) {
      // **没挂数据源的项目只留发现类工具。** 空 sources 发出去的场景头是空串,
      // 而非 account 的旧式 token 会忽略场景头、落回它自己烘焙的租户 —— 实测:
      // 一个写着"只用你自己的文件"的项目,agent 在里面回答了整页另一个厂的排产
      // 数据,界面上还完全正常。见 compass-sourceless.ts。
      compassOverlay = {
        [scope.entryPin]: restrictSourcelessToolset(
          (pooled[scope.entryPin] ?? {}) as Record<string, unknown>,
          scope.sources,
        ),
      };
    } else {
      // Honest refusal: the pool could not produce a connection for THIS
      // scene set, so compass vanishes from the request — active list, tool
      // index (below), and subagent allowlist. Never a tenant-cache fallback
      // (there is none for compass) and never another scene-set's toolsets.
      activeMcp = activeMcp.filter((server) => server !== scope.entryPin);
      scopedMcpServersForSubagents = scopedMcpServersForSubagents.filter(
        (server) => server !== scope.entryPin,
      );
    }
  }

  // Scope the tool-search index to this request's active servers — otherwise
  // tool_search would let the model discover (and name) tools on non-pinned
  // group members or servers disabled by the client. The tenant index never
  // contains compass entries (compass is excluded from the generic client),
  // so the pooled entries are appended from the overlay — and only when the
  // overlay actually resolved (pool failure ⇒ no compass in the index).
  const scopedIndex = filterMcpToolIndexToScopedServers(args.mcpToolIndex, activeMcp);
  const mcpToolNames =
    compassOverlay == null
      ? scopedIndex
      : [
          ...scopedIndex,
          ...getCompassToolIndexEntries(scope.entryPin!, compassOverlay).filter(
            (entry) => !scopedIndex.some((existing) => existing.id === entry.id),
          ),
        ];

  return {
    scope,
    projectPin: scope.project?.id ?? null,
    activeMcp,
    mcpToolNames,
    scopedMcpServersForSubagents,
    compassOverlay,
  };
}

/**
 * 把一条 web 流泵到 socket。**客户端没了就只读不写**,不停、不销毁源。
 *
 * 为什么不用 `pipe`:socket 一关,pipe 会把源一起销毁 —— 主流程里那个源是
 * 正在生成的这一轮(于是刷新就把答案掐了),恢复端点里那个源是可恢复缓冲的
 * 读取游标(于是重连读到一半就断)。两处都栽在同一件事上。
 */
function pumpToSocket(body: ReadableStream<Uint8Array>, socket: ServerResponse): void {
  const reader = body.getReader();
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && !socket.destroyed && !socket.writableEnded) socket.write(value);
      }
    } catch {
      /* 读不动就收工 —— 这条路上没有比"别把源掐了"更重要的事 */
    } finally {
      if (!socket.destroyed && !socket.writableEnded) socket.end();
    }
  })();
}

export function registerChatRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.post('/api/chat', async (req, reply) => {
    const body = parseChatBody(req.body);
    const ctx = await deps.resolveContext(req.headers);
    const resume = body.resume;
    const isResume = resume != null;
    const messages = body.messages ?? [];
    if (!isResume && messages.length === 0) {
      return reply.status(400).send({ error: 'messages required' });
    }
    if (
      isResume &&
      (typeof resume !== 'object' ||
        typeof resume.runId !== 'string' ||
        !resume.runId.trim() ||
        (resume.toolCallId != null &&
          (typeof resume.toolCallId !== 'string' || !resume.toolCallId.trim())) ||
        !Object.prototype.hasOwnProperty.call(resume, 'resumeData'))
    ) {
      return reply.status(400).send({ error: 'invalid_resume' });
    }
    const requestedThreadId = body.id ?? body.threadId;
    if (
      (requestedThreadId != null &&
        (typeof requestedThreadId !== 'string' || !requestedThreadId.trim())) ||
      (isResume && typeof requestedThreadId !== 'string')
    ) {
      return reply.status(400).send({ error: 'invalid_thread_id' });
    }
    if (body.agentId != null && (typeof body.agentId !== 'string' || !body.agentId.trim())) {
      return reply.status(400).send({ error: 'invalid_agent_id' });
    }

    await applyTenantModelSettings(ctx.tenantId);
    await deps.ensureMcpForTenant(ctx.tenantId);
    await reloadHooksForTenant(ctx.tenantId);
    const hookBus = getHookBus(ctx.tenantId);
    const threadId = requestedThreadId ?? `thread-${ctx.userId}`;
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
      if (isResume) {
        if (before) {
          try {
            threadRow = await requireThreadOwnership(threadId, ctx);
          } catch (err) {
            if (deps.isForbiddenError(err)) {
              return reply.status(403).send({ error: 'forbidden' });
            }
            throw err;
          }
        } else {
          // A prior ephemeral turn may have suspended while the datastore was
          // unavailable. The process-local run registry remains authoritative.
          threadRow = ephemeralThreadState(identity);
        }
      } else {
        threadRow = await ensureThreadState(identity);
      }
      if (before) await touchThreadActivity(threadId);
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
    if (!isResume) {
      await stopChatStream({ threadId }).catch(() => undefined);
    }
    if (threadStoreOk && !isResume) {
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
    const agent = deps.runtime.getAgent(agentId);
    if (!agent) {
      return reply.status(404).send({ error: 'agent_not_found' });
    }
    const modelKey = (body.model ?? 'default') as ModelKey;
    const modelConfig = getModelConfig(modelKey);
    if (!modelConfig.apiKey.trim()) {
      return reply.status(400).send({
        error: 'model_not_configured',
        message: 'Model API key is not configured. Open Settings -> Models and add your own API key.',
      });
    }

    if (!isResume && threadStoreOk && !threadRow.title?.trim()) {
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
    // from scoping by claiming it's disabled and force a re-pin. See attack
    // test in mcp-scoping.test.ts.
    const tenantActiveMcp = await withDatastoreFallback(
      () => listActiveMcpServerNames(ctx.tenantId, declaredMcp),
      [] as string[],
    );

    // Server-side project scoping: narrow each grouped MCP server down to the
    // thread's pinned project. A group's pin winner survives regardless of
    // mcpEnabled; every other member of that group is dropped regardless of
    // mcpEnabled too — a project switch happens only via the explicit
    // POST /api/project route (setProject).
    const mcpServerGroups = await withDatastoreFallback(
      () => listMcpServerGroups(ctx.tenantId),
      {} as Record<string, string | undefined>,
    );
    // v3: the thread pin is a PROJECT id. `resolveChatMcpScope` (above) is
    // the shared prelude (pin → entry-level pin, once) + the UNCHANGED pure
    // scoping functions + the pooled compass overlay — see its docstring for
    // the guarantee-preservation notes.
    const threadProjectPin = threadRowState?.project ?? null;
    const mcpScope = await resolveChatMcpScope({
      tenantId: ctx.tenantId,
      threadProjectPin,
      tenantActiveMcp,
      mcpServerGroups,
      mcpEnabled,
      mcpToolIndex: deps.getMcpToolIndex(),
    });
    const { scope, activeMcp, scopedMcpServersForSubagents } = mcpScope;
    // Provenance/display pin value: the resolved project's id (null when the
    // pin denied) — NOT an MCP entry name anymore.
    const projectPin = mcpScope.projectPin;

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
    // Tool-search index + subagent allowlist: both derived inside
    // resolveChatMcpScope (see its docstring — the tool index is scoped to
    // activeMcp with pooled compass entries appended only when the pool
    // resolved; the allowlist keeps the explicit-off suppression and the
    // ungrouped-toggle-ignore semantics unchanged).
    requestContext.set('mcpToolNames', mcpScope.mcpToolNames);
    requestContext.set('scopedMcpServers', scopedMcpServersForSubagents);
    requestContext.set('projectPin', projectPin);
    // Tenant project rows for the provenance legacy-stamp shim (Phase B 5c):
    // table_get / buildTableContextBlock map a pre-migration `source.server`
    // stamp to its project id via legacyServerToProjectId. Fetched only for
    // pinned turns (the mismatch predicate is inert without a pin); a
    // datastore failure degrades to [] — legacy stamps then read as
    // unmappable and hard-refuse (fail-closed, never a leak).
    const tenantProjects =
      projectPin != null
        ? await withDatastoreFallback(() => listProjects(ctx.tenantId), [])
        : [];
    requestContext.set('tenantProjects', tenantProjects);
    // 5b/5c consumers: the resolved project scope (id/name for provenance +
    // display, sources for pooled lookups, entryPin for toolset resolution).
    requestContext.set(
      'pinnedProjectScope',
      scope.project
        ? {
            id: scope.project.id,
            name: scope.project.name,
            sources: scope.sources,
            entryPin: scope.entryPin,
            // REST data-plane scope for the SAME pin (Task 6) — null when the
            // pin resolved to a project but no enabled compass entry (no
            // scene set to bind a REST call to, mirrors entryPin === null).
            rest: scope.entry
              ? {
                  baseUrl: compassRestBase(scope.entry.url),
                  headers: {
                    ...scope.entry.headers,
                    'x-compass-source': sceneSetKey(scope.sources),
                  },
                }
              : null,
          }
        : null,
    );
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

    let useThreadMemory = threadStoreOk && !isResume;
    if (!isResume) {
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
    }

    // Per-agent MCP: only expose declared servers; none when undeclared.
    // Uses the project-scoped + mcpEnabled-filtered + pool-honest list
    // (activeMcp), not the raw server-truth list. Compass toolsets can ONLY
    // enter through the pooled overlay — the tenant cache never contains them
    // (buildMcpServerConfigs skips the compass group), so a wrong-scene-set
    // substitution is structurally impossible here: the overlay either holds
    // the pinned project's scene-set connection or compass is absent.
    const agentMcp =
      planMode
        ? {}
        : {
            ...(activeMcp.length > 0
              ? Object.fromEntries(
                  Object.entries(deps.getMcpToolsets()).filter(([server]) =>
                    activeMcp.includes(server),
                  ),
                )
              : {}),
            ...(mcpScope.compassOverlay ?? {}),
          };
    // Final per-request toolsets for 5b/5c consumers (table/schedule tool
    // resolution, subagent toolset overlay) — the ONE record downstream code
    // should resolve compass from during this chat turn.
    requestContext.set('scopedMcpToolsets', agentMcp);

    const effectiveModel = body.model ?? deps.runtime.definitions.get(agentId)?.definition.model;
    let agentMessages: Awaited<ReturnType<typeof toAgentMessages>> = [];
    if (!isResume) {
      let agentInputMessages = messages as UiMessage[];
      if (useThreadMemory) {
        try {
          const recalled = await recallOrEmpty(deps.runtime.memory, {
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
      // **前端工具挂起、而用户直接打字回复**时,把那条悬空的工具调用摘掉。
      // 不摘的话,每次调模型都带着一个没有结果的 tool call,之后每一轮 assistant
      // 都只产出一个空 step —— 界面上就是"我说了话,它不理我",而且永远不会自己恢复
      // (实测:ask_user_question 挂起后用户回"好了,我绑好文件夹了",连续两轮全空)。
      agentInputMessages = stripUnansweredToolCallsForAgent(agentInputMessages);
      agentMessages = await toAgentMessages(
        agentInputMessages as Parameters<typeof toAgentMessages>[0],
        modelSupportsImages(effectiveModel),
      );
      if (body.pendingLoop === true && !isLoopActive(threadRowState?.loop)) {
        agentMessages = appendPendingLoopTurnNote(agentMessages);
      }
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
    const tableBlockBase = planMode
      ? ''
      : buildTableContextBlock(resolveSheetScope(threadId, projectPin), projectPin, tenantProjects);
    // Thread-tied (unlike the workspace grid's own schedule-edit HTTP routes,
    // see mcp-scoping.ts's module docstring): this request already resolved
    // its final per-request toolsets (`agentMcp`, pooled compass included)
    // and the entry-level pin above, so the guidance text's "is Compass
    // connected" check agrees with what THIS turn can actually call — the
    // tenant cache would always say "not connected" now that compass lives
    // only in the pool.
    const editGuidance = planMode
      ? ''
      : scheduleEditGuidanceBlock(() => agentMcp, mcpServerGroups, scope.entryPin);
    // 与 editGuidance 同源同参:本轮真实的 agentMcp + entry pin,所以"是否连上
    // compass"的判断与本轮真正能调的工具一致。planMode 下同样跳过。
    const compassGrounding = planMode
      ? ''
      : buildCompassGroundingBlock(() => agentMcp, mcpServerGroups, scope.entryPin);
    // 变更事件推进上下文:重新读表只能看到新值,看不到"改过"。放在表格块之后 ——
    // 先说"表里有什么",再说"刚才谁改了什么"(见 table-edit-journal.ts)。
    const tableEdits = planMode ? '' : formatTableEditsBlock(threadId);
    // 「文件夹即上下文」:提示块里放的是**清单**,内容按需走 project_file_read。
    // 放进去几乎不花 token,却让 agent 知道这里有什么 —— 否则它只能猜。
    let projectFilesBlock = '';
    if (!planMode && projectPin) {
      try {
        const { getProject } = await import('../project-store.js');
        const folder = (await getProject(ctx.tenantId, projectPin))?.folder;
        if (folder) {
          const { listProjectFiles } = await import('../project-context.js');
          const { scanProjectInbox } = await import('../project-inbox.js');
          const [archived, inbox] = await Promise.all([
            listProjectFiles(folder),
            scanProjectInbox(folder),
          ]);
          projectFilesBlock = formatProjectFilesBlock(folder, [
            ...archived.originals.map((f) => ({ name: f.name, bytes: f.bytes })),
            ...archived.snapshots.map((f) => ({ name: `快照/${f.name}`, bytes: f.bytes })),
            ...inbox.pending.map((f) => ({ name: f.name, bytes: f.bytes })),
          ]);
        }
      } catch {
        /* 读不到文件夹就不放这一段 —— 它是陈述,不该让一轮对话失败 */
      }
    }

    const tableBlock = [tableBlockBase, projectFilesBlock, tableEdits, editGuidance]
      .filter(Boolean).join('\n\n');
    const viewer3dBlock = planMode ? '' : buildViewer3dContextBlock();
    const knowledgeBlock = planMode
      ? ''
      : await withDatastoreFallback(() => buildKnowledgeContextBlock(ctx.tenantId, threadId), '');
    const workspacePanelBlock = planMode
      ? ''
      : buildWorkspacePanelHintBlock(body.workspacePanel);
    const localeBlock = buildLocaleBlock(body.locale);
    const attachedBrowserBlock = buildAttachedBrowserBlock(body.attachedBrowser);
    // v3: the model-facing reminder names the PROJECT (display name + source
    // labels), never a raw pin value — a project id would be meaningless and
    // an entry name no longer exists per project. Unpinned/denied pins get
    // the personal-area hint (null label); `movedFrom` stays the raw stored
    // value (display-only legacy entry name or project id).
    const projectPinBlock = buildProjectPinBlock(
      scope.project ? projectPinLabel(scope.project) : null,
      {
        movedFrom: threadRowState?.movedFrom ?? null,
        movedAt: threadRowState?.movedAt ?? null,
      },
      scope.project?.instructions ?? null,
      Boolean(scope.project) && (scope.project?.sources.length ?? 0) === 0,
    );
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
      compassGroundingBlock: compassGrounding,
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

    if (!isResume) {
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
    const suspensionOwner = {
      threadId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      agentId,
    };
    let consumedSuspended: SuspendedRunRecord | null = null;
    let stream;
    try {
      // Do NOT pass `memory` into agent.stream. Mastra's SaveQueue / MessageHistory
      // append-saves a new assistant id per step (and on background-task flush)
      // without deleting prior snapshots — ask continuations then pile up and
      // concat-content shows the turn as duplicated. Thread context is already
      // recalled above; WM is injected via systemBlocks; persistence is
      // client-authoritative via syncThreadMessagesFromClient.
      const streamOptions = {
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
      };
      if (resume) {
        const persisted = threadRowState?.suspendedRun;
        if (
          persisted?.runId === resume.runId &&
          persisted.toolCallId === resume.toolCallId &&
          persisted.agentId === agentId
        ) {
          registerSuspendedRun({
            ...suspensionOwner,
            ...persisted,
          });
        }
        consumedSuspended = consumeSuspendedRun(
          suspensionOwner,
          resume.runId,
          resume.toolCallId,
        );
        if (!consumedSuspended) {
          unregisterRunAbort(streamId);
          return reply.status(409).send({ error: 'invalid_or_consumed_resume' });
        }
        // Validate and reserve the exact suspended run before touching any live
        // stream. A duplicate resume must return 409 without aborting the first.
        await stopChatStream({ threadId }).catch(() => undefined);
        await setThreadSuspendedRun(threadId, null);
        // **把答案写回历史。** resumeData 只喂给这一次 resumeStream,从来不落库;
        // 而 resume 这一轮又整个跳过了客户端成绩单同步(见上面的 `if (!isResume)`)。
        // 不写的话,历史里那个 tool call 永远停在"还在等人答",后面每一轮都不知道
        // 用户当时选了什么 —— 只能再问一遍。摘掉悬空调用是止血,这才是止因。
        const answeredToolCallId = resume.toolCallId ?? consumedSuspended.toolCallId;
        if (answeredToolCallId) {
          await persistAskAnswer(
            deps.runtime.memory as never,
            { threadId, resourceId: ctx.userId },
            answeredToolCallId,
            resume.resumeData,
          );
        }
        stream = await agent.resumeStream(resume.resumeData, {
          ...streamOptions,
          runId: resume.runId,
          toolCallId: resume.toolCallId ?? consumedSuspended.toolCallId,
        } as never);
      } else {
        // 用户没走 resume 而是直接发了新消息 —— 那条挂起已经作废了。不清掉的话
        // 它会一直挂在线程状态上,而对应的 tool call 永远等不到答案。
        if (threadRowState?.suspendedRun) {
          await setThreadSuspendedRun(threadId, null).catch(() => undefined);
        }
        stream = await agent.stream(agentMessages as never, streamOptions as never);
      }
    } catch (err) {
      await hookBus.emit(
        'StopFailure',
        {
          error_type: 'server_error',
          error: err instanceof Error ? err.message : String(err),
        },
        { threadId },
      );
      if (consumedSuspended) {
        registerSuspendedRun(consumedSuspended, { restoreConsumed: true });
        await setThreadSuspendedRun(threadId, {
          agentId: consumedSuspended.agentId,
          runId: consumedSuspended.runId,
          toolCallId: consumedSuspended.toolCallId,
          suspendPayload: consumedSuspended.suspendPayload,
          createdAt: consumedSuspended.createdAt,
        }).catch(() => undefined);
      }
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

    let originalUiMessages = messages as UiMessage[];
    if (resume) {
      try {
        const recalled = await deps.runtime.memory.recall({
          threadId,
          resourceId: ctx.userId,
          perPage: false,
        });
        originalUiMessages = mastraMessagesToUi(recalled.messages ?? []);
      } catch (err) {
        app.log.warn(
          { err, threadId, runId: resume.runId },
          'resume UI context recall failed',
        );
      }
    }

    const from = 'agent';
    let sawSuspension = false;
    let sawVisibleOutput = false;
    let sawStreamError = false;
    const uiMessageStream = createUIMessageStream({
      originalMessages: originalUiMessages as never,
      onFinish: () => {
        clearInterval(cancelPoll);
        unregisterRunAbort(streamId);
        void clearActiveStream(threadId).catch((err) => {
          app.log.warn({ err, threadId }, 'clearActiveStream failed');
        });
        markThreadChatActivity(threadId, 'finished');
        if (!sawSuspension) {
          void setThreadSuspendedRun(threadId, null).catch((err) => {
            app.log.warn({ err, threadId }, 'clear suspended run state failed');
          });
        }
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
            const observedPart = observeSuspensionChunk(part, suspensionOwner);
            const suspensionPart = observedPart as {
              type?: string;
              data?: {
                runId?: unknown;
                toolCallId?: unknown;
                suspendPayload?: unknown;
                suspendedAt?: unknown;
              };
            };
            if (
              suspensionPart.type === 'data-tool-call-suspended' &&
              typeof suspensionPart.data?.runId === 'string' &&
              typeof suspensionPart.data.toolCallId === 'string'
            ) {
              sawSuspension = true;
              await setThreadSuspendedRun(threadId, {
                agentId,
                runId: suspensionPart.data.runId,
                toolCallId: suspensionPart.data.toolCallId,
                suspendPayload: suspensionPart.data.suspendPayload,
                createdAt:
                  typeof suspensionPart.data.suspendedAt === 'number'
                    ? suspensionPart.data.suspendedAt
                    : Date.now(),
              });
            }
            // Input processors may finish after stream() returns; emit once when payload appears.
            writeCompactNoticeIfNeeded();
            for (const repaired of repairUiStreamChunk(observedPart as never, streamRepair)) {
              writer.write(repaired as never);
            }
            const partType = (observedPart as { type?: string }).type;
            if (isVisibleStreamPart({ ...(partType ? { type: partType } : {}) })) {
              sawVisibleOutput = true;
            }
            if (partType === 'error') sawStreamError = true;
            if (partType === 'finish-step' || partType === 'finish') {
              writeContextUsageIfNeeded(lastStepUsage);
            }
          }
          // 流正常走完却一个字都没有 —— Mastra 把模型侧的错误 log 完就 return,
          // 下面那个 catch 根本不触发,用户只看到空白(实测两次都是这样)。
          if (
            shouldReportEmptyTurn({
              sawVisibleOutput,
              sawSuspension,
              sawError: sawStreamError,
              aborted: runAbort.signal.aborted,
            })
          ) {
            req.log.warn({ threadId }, 'turn produced no visible output');
            writer.write({ type: 'error', errorText: EMPTY_TURN_NOTICE } as never);
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
      // **不能用 pipe。** 客户端一刷新,socket 关掉,pipe 会把源一起销毁 ——
      // 于是这一轮的生成当场停住,可恢复缓冲里只留下断开那一刻的半句。刷新之后
      // "恢复"出来的永远是残句(实测:基线 198 字的回答只剩 19 字)。
      //
      // 自己泵:**客户端没了就只读不写**,把这一轮读完。生成继续跑到底,
      // captureSseToResumable 收全,重连才有完整内容可给。
      reply.raw.on('close', clearRawKeepAlive);
      pumpToSocket(response.body as ReadableStream<Uint8Array>, reply.raw);
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
    // 和上面主流程同理:pipe 会在客户端断开时把源一起销毁,而源就是**可恢复
    // 缓冲的读取游标**。销毁它等于把这次重连读到一半的位置丢掉。自己泵,
    // 客户端没了就只读不写。
    pumpToSocket(resumed.body as ReadableStream<Uint8Array>, reply.raw);
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
    // 和上面主流程同理:pipe 会在客户端断开时把源一起销毁,而源就是**可恢复
    // 缓冲的读取游标**。销毁它等于把这次重连读到一半的位置丢掉。自己泵,
    // 客户端没了就只读不写。
    pumpToSocket(resumed.body as ReadableStream<Uint8Array>, reply.raw);
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
