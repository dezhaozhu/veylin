import './env';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { toAISdkStream } from '@mastra/ai-sdk';
import { MCPClient } from '@mastra/mcp';
import { RequestContext } from '@mastra/core/di';
import {
  createRuntime,
  DEFAULT_AGENT_ID,
  getModelConfig,
  getDefaultCatalogModel,
  listModelCatalogPublic,
  loadModelCatalog,
  type ModelKey,
} from '@veylin/runtime';
import { setThreadPlanMode } from '@veylin/tools';
import { toNodeHandler } from 'better-auth/node';
import { auth, isDesktopAuth } from './auth';
import {
  createInProcQueue,
  registerWorkers,
  registerSchedules,
  registerAutomationWorkers,
  registerAutomationSchedule,
  unregisterAutomationSchedule,
  registerWorkflowWorkers,
  registerWorkflowSchedule,
  unregisterWorkflowSchedule,
  SUBAGENT_QUEUE,
  type SubagentJob,
  type ScheduleSpec,
  type AutomationJob,
  type WorkflowJob,
} from './queue';
import { recordAudit } from './audit';
import { buildAttachedBrowserBlock, lastUserText, modelSupportsImages, parseChatBody, toAgentMessages } from './chat';
import { buildAgentTaskTools } from './agent-task-tool';
import { executeSubagentJob, CancelledTaskError, listDispatchableCustomAgentIds } from './agent-task-runner';
import { scheduleDreamConsolidation } from './dream-service';
import { buildTableTools } from './table-tools';
import {
  addTableColumn,
  addTableRow,
  createTableSheet,
  deleteTableColumn,
  deleteTableRows,
  deleteTableSheet,
  importTableSheet,
  initTableStore,
  listTableColumns,
  listTableRows,
  listTableSheets,
  resolveTableSheetId,
  updateTableRow,
  DEFAULT_TABLE_SHEET,
  type TableRowPatch,
} from './table-store';
import {
  activateSkill,
  ensureThreadState,
  getSkillMemoryBlock,
  getThreadState,
  setPlanMode as setThreadPlanModeDb,
  setTodos as setThreadTodosDb,
  syncWorkingMemory,
  restoreTodosFromHistoryIfEmpty,
  setThreadTitle,
  listThreadsForResource,
  deleteThreadState,
  touchThreadActivity,
  requireThreadOwnership,
  resolveThreadForRead,
  pruneDesktopThreadClutter,
} from './thread-state';
import { buildReminderBlock } from './reminders';
import { listThreadActivity } from './thread-activity';
import { syncThreadMessagesFromClient } from './thread-sync';
import { generateThreadTitle } from './thread-title';
import { mastraMessagesToUi } from './message-sync';
import { filterExternalToolsets } from './toolsets';
import { ContextCompression, buildLocaleBlock, buildSummarizer, buildAgentOrchestrationBlock, buildCoordinatorOrchestrationBlock, isCoordinatorMode } from '@veylin/runtime';
import {
  bindActiveStream,
  captureSseToResumable,
  clearActiveStream,
  createRunAbortController,
  getActiveStreamId,
  initResumableChatStreams,
  isStreamCancelled,
  mergeResumableStreamHeaders,
  resolveResumeCursor,
  resumeStreamResponse,
  stopChatStream,
  unregisterRunAbort,
} from './resumable-chat-stream';
import { ensureDevTenant, resolveTenantForUser, DEV_TENANT_ID } from './tenant';
import { refreshAgentPackages, requireAgent } from './agent-packages-sync';
import {
  listMergedSkills,
  createCustomSkill,
  updateCustomSkill,
  deleteCustomSkill,
  setDisabledSkills,
  getDisabledSkills,
  getDisabledMcpServers,
  setDisabledMcpServers,
  resolveSkillContent,
  buildSkillsCatalogBlock,
} from './skills-store';
import {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  buildRulesMemoryBlock,
} from './rules-store';
import {
  listRemoteMcpServers,
  createRemoteMcpServer,
  updateRemoteMcpServer,
  deleteRemoteMcpServer,
  createMcpClient,
  listActiveMcpServerNames,
} from './mcp-store';
import {
  listAutomations,
  listAllCronAutomations,
  getAutomation,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  listAutomationRuns,
  listEventAutomations,
  matchesEventTrigger,
} from './automation-store';
import { runAutomationJob, dispatchAutomation } from './automation-worker';
import { buildWorkspaceConfigTool } from './workspace-config-tool';
import {
  listWorkflows,
  listAllCronWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  listWorkflowRuns,
  listEventWorkflows,
  WorkflowNameConflictError,
} from './workflow-store';
import { runWorkflowJob, dispatchWorkflow } from './workflow-runner';
import { generateWorkflowFromPrompt } from './workflow-generate';
import { buildWorkflowTools } from './workflow-tools';
import {
  listWebhookEndpoints,
  createWebhookEndpoint,
  createGithubWebhookEndpoint,
  deleteWebhookEndpoint,
  updateWebhookEndpoint,
  getWebhookConfig,
  verifyWebhookSignature,
  resolveEventKey,
  buildEventContext,
} from './webhook-store';
import {
  applyTenantModelSettings,
  getModelSettings,
  updateModelSettings,
  clearModelSettings,
} from './model-settings-store';
import { customSkillInputSchema, ruleInputSchema, mcpServerInputSchema, automationInputSchema, workflowInputSchema, webhookCreateInputSchema, webhookUpdateInputSchema } from '@veylin/shared';
import { z } from 'zod';
import {
  buildKnowledgeSearchTool,
  buildKnowledgeContextBlock,
  ingestDocumentText,
  getLastKnowledgeReferences,
  listKnowledgeDocuments,
  removeKnowledgeDocument,
  searchKnowledge,
} from './rag-store';
import { extractPdfText } from './extract-pdf-text';
import { RAG_UPLOAD_MAX_BYTES } from './rag-limits';
import {
  connectDb,
  ensureDataDir,
  listGraphForTenant,
  listTasksByParentThread,
  getTaskRow,
  updateTaskRow,
  mastraLibsqlUrl,
} from '@veylin/db';

const DATA_DIR = ensureDataDir();
const PORT = Number(process.env.PORT ?? 8787);

// Agent definitions (agent.yaml + skills). Dev: repo examples/; sidecar: copied beside server.mjs.
function resolveAgentsDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const besideBundle = join(moduleDir, 'examples');
  const repoExamples = fileURLToPath(new URL('../../../examples', import.meta.url));
  if (existsSync(join(besideBundle, 'veylin', 'agent.yaml'))) return besideBundle;
  if (existsSync(join(repoExamples, 'veylin', 'agent.yaml'))) return repoExamples;
  if (existsSync(besideBundle)) return besideBundle;
  return repoExamples;
}

const AGENTS_DIR = resolveAgentsDir();

function indexMcpTools(toolsets: Record<string, unknown>): { id: string; description: string }[] {
  const out: { id: string; description: string }[] = [];
  for (const [server, tools] of Object.entries(toolsets)) {
    if (!tools || typeof tools !== 'object') continue;
    for (const [name, tool] of Object.entries(tools as Record<string, unknown>)) {
      const desc = (tool as { description?: string })?.description ?? name;
      out.push({ id: `mcp__${server}__${name}`, description: desc });
    }
  }
  return out;
}

async function resolveContext(headers: Record<string, string | string[] | undefined>) {
  try {
    const session = await auth.api.getSession({ headers: headers as never });
    if (session?.user) {
      const tenantId = await resolveTenantForUser(session.user.id, session.user.name ?? undefined);
      return { userId: session.user.id, tenantId, authed: true };
    }
  } catch {
    // fall through to dev context
  }
  return { userId: 'dev-user', tenantId: DEV_TENANT_ID, authed: false };
}

function isForbiddenError(err: unknown): boolean {
  return err instanceof Error && err.message === 'forbidden';
}

async function main() {
  await connectDb();
  await initResumableChatStreams();
  await initTableStore();
  await ensureDevTenant();

  let mcp: MCPClient | null = null;
  let mcpToolsets: Record<string, unknown> = {};
  let mcpToolIndex: { id: string; description: string }[] = [];
  const mcpCacheByTenant = new Map<
    string,
    { toolsets: Record<string, unknown>; index: { id: string; description: string }[] }
  >();
  let taskToolset: Record<string, unknown> = {};

  async function rebuildMcp(tenantId: string) {
    mcp = await createMcpClient(tenantId);
    mcpToolsets = (await mcp.listToolsets().catch(() => ({}))) as Record<string, unknown>;
    mcpToolIndex = indexMcpTools(mcpToolsets);
    mcpCacheByTenant.set(tenantId, { toolsets: mcpToolsets, index: mcpToolIndex });
  }

  async function ensureMcpForTenant(tenantId: string) {
    const cached = mcpCacheByTenant.get(tenantId);
    if (cached) {
      mcpToolsets = cached.toolsets;
      mcpToolIndex = cached.index;
      return;
    }
    await rebuildMcp(tenantId);
  }

  const app = Fastify({
    logger: true,
    bodyLimit: RAG_UPLOAD_MAX_BYTES,
  });

  app.addHook('preParsing', async (request, _reply, payload) => {
    if (request.method !== 'POST' || !request.url.startsWith('/api/events/')) {
      return payload;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const raw = Buffer.concat(chunks);
    (request as typeof request & { rawBody?: Buffer }).rawBody = raw;
    return Readable.from(raw);
  });

  const runtime = await createRuntime({
    dataDir: DATA_DIR,
    libsqlUrl: mastraLibsqlUrl(DATA_DIR),
    agentsDir: AGENTS_DIR,
  });
  if (isDesktopAuth) {
    await pruneDesktopThreadClutter(DEV_TENANT_ID, 'dev-user', runtime.memory);
  }
  app.log.info({ agentsDir: AGENTS_DIR }, 'agent packages reload on each customize/chat request');
  const queue = createInProcQueue();
  await queue.start();

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  if (!isDesktopAuth) {
    const { betterAuth } = await import('better-auth');
    const { memoryAdapter } = await import('better-auth/adapters/memory');
    const { setAuth } = await import('./auth');
    setAuth(
      betterAuth({
        database: memoryAdapter({}),
        emailAndPassword: { enabled: true },
        secret: process.env.AUTH_SECRET,
        baseURL: process.env.AUTH_BASE_URL,
      }) as never,
    );
  }

  // better-auth owns /api/auth/* when enabled.
  if (!isDesktopAuth) {
    await app.register(async (authScope) => {
      authScope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
        done(null, body);
      });
      authScope.route({
        method: ['GET', 'POST'],
        url: '/api/auth/*',
        handler: async (req, reply) => {
          reply.hijack();
          await toNodeHandler(auth)(req.raw, reply.raw);
        },
      });
    });
  }

  app.get('/health', async () => ({ ok: true }));

  // Agent picker source for the UI.
  app.get('/api/agents', async () => ({ agents: runtime.listAgents() }));

  app.get('/api/model-settings', async (req) => {
    const ctx = await resolveContext(req.headers);
    const catalog = loadModelCatalog();
    if (catalog.length > 0) {
      const primary = getDefaultCatalogModel() ?? catalog[0]!;
      return {
        settings: {
          modelName: primary.label,
          requestUrl: 'local-catalog',
          hasApiKey: true,
          configured: true,
        },
      };
    }
    return { settings: await getModelSettings(ctx.tenantId) };
  });

  app.get('/api/model-catalog', async () => {
    const models = listModelCatalogPublic();
    const primary = getDefaultCatalogModel();
    return {
      models,
      defaultId: primary?.id ?? models[0]?.id ?? null,
    };
  });

  app.put('/api/model-settings', async (req) => {
    const ctx = await resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      modelName?: string;
      requestUrl?: string;
      apiKey?: string;
    };
    return { settings: await updateModelSettings(ctx.tenantId, body) };
  });

  app.delete('/api/model-settings', async (req) => {
    const ctx = await resolveContext(req.headers);
    return { settings: await clearModelSettings(ctx.tenantId) };
  });

  app.get('/api/agent-context', async (req) => {
    const { agentId } = req.query as { agentId?: string };
    const ctx = await resolveContext(req.headers);
    await refreshAgentPackages(runtime);
    const base = runtime.getAgentContext(agentId);
    const resolvedAgentId = agentId ?? base.agentId;
    const mergedSkills = await listMergedSkills(runtime, ctx.tenantId, resolvedAgentId);
    const declaredMcp = runtime.definitions.get(resolvedAgentId)?.definition.mcpServers ?? base.mcpServers;
    const mcpServers = await listActiveMcpServerNames(ctx.tenantId, declaredMcp);
    return {
      ...base,
      agentId: resolvedAgentId,
      skills: mergedSkills
        .filter((s) => s.enabled)
        .map((s) => ({ name: s.name, description: s.description })),
      mcpServers,
    };
  });

  // --- Customize: Skills ---
  app.get('/api/skills', async (req) => {
    const ctx = await resolveContext(req.headers);
    const { agentId } = req.query as { agentId?: string };
    const skills = await listMergedSkills(runtime, ctx.tenantId, agentId);
    const disabledSkills = await getDisabledSkills(ctx.tenantId);
    return { skills, disabledSkills };
  });

  app.post('/api/skills/disabled', async (req) => {
    const ctx = await resolveContext(req.headers);
    const { disabledSkills } = (req.body ?? {}) as { disabledSkills?: string[] };
    await setDisabledSkills(ctx.tenantId, disabledSkills ?? []);
    return { ok: true, disabledSkills: disabledSkills ?? [] };
  });

  app.post('/api/skills', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const parsed = customSkillInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const row = await createCustomSkill(ctx.tenantId, parsed.data);
    return { ok: true, skill: row };
  });

  app.put('/api/skills/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const parsed = customSkillInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const row = await updateCustomSkill(ctx.tenantId, id, parsed.data);
    if (!row) {
      reply.code(404);
      return { ok: false };
    }
    return { ok: true, skill: row };
  });

  app.delete('/api/skills/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const ok = await deleteCustomSkill(ctx.tenantId, id);
    if (!ok) {
      reply.code(404);
      return { ok: false };
    }
    return { ok: true };
  });

  // --- Customize: Rules ---
  app.get('/api/rules', async (req) => {
    const ctx = await resolveContext(req.headers);
    const { agentId } = req.query as { agentId?: string };
    const rules = await listRules(ctx.tenantId, ctx.userId, agentId);
    return { rules };
  });

  app.post('/api/rules', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const parsed = ruleInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const rule = await createRule(ctx.tenantId, parsed.data);
    return { ok: true, rule };
  });

  app.put('/api/rules/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const parsed = ruleInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const rule = await updateRule(ctx.tenantId, id, parsed.data);
    if (!rule) {
      reply.code(404);
      return { ok: false };
    }
    return { ok: true, rule };
  });

  app.delete('/api/rules/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const ok = await deleteRule(ctx.tenantId, id);
    if (!ok) {
      reply.code(404);
      return { ok: false };
    }
    return { ok: true };
  });

  // --- Customize: MCP ---
  app.get('/api/mcp-servers', async (req) => {
    const ctx = await resolveContext(req.headers);
    const remote = await listRemoteMcpServers(ctx.tenantId);
    const disabledMcp = await getDisabledMcpServers(ctx.tenantId);
    // Installed MCP is user-managed (remote); bundled stdio servers are opt-in via agent config only.
    return { bundled: [], remote, disabledMcp };
  });

  app.post('/api/mcp-servers/disabled', async (req) => {
    const ctx = await resolveContext(req.headers);
    const { disabledMcp } = (req.body ?? {}) as { disabledMcp?: string[] };
    await setDisabledMcpServers(ctx.tenantId, disabledMcp ?? []);
    return { ok: true, disabledMcp: disabledMcp ?? [] };
  });

  app.post('/api/mcp-servers', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const parsed = mcpServerInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const server = await createRemoteMcpServer(ctx.tenantId, parsed.data);
    await rebuildMcp(ctx.tenantId);
    return { ok: true, server };
  });

  app.put('/api/mcp-servers/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const parsed = mcpServerInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const server = await updateRemoteMcpServer(ctx.tenantId, id, parsed.data);
    if (!server) {
      reply.code(404);
      return { ok: false };
    }
    await rebuildMcp(ctx.tenantId);
    return { ok: true, server };
  });

  app.delete('/api/mcp-servers/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const ok = await deleteRemoteMcpServer(ctx.tenantId, id);
    if (!ok) {
      reply.code(404);
      return { ok: false };
    }
    await rebuildMcp(ctx.tenantId);
    return { ok: true };
  });

  // --- Automate: Automations ---
  app.get('/api/automations', async (req) => {
    const ctx = await resolveContext(req.headers);
    const automations = await listAutomations(ctx.tenantId, ctx.userId);
    return { automations };
  });

  app.get('/api/automations/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const automation = await getAutomation(ctx.tenantId, id);
    if (!automation) {
      reply.code(404);
      return { ok: false };
    }
    return { automation };
  });

  app.post('/api/automations', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const parsed = automationInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const automation = await createAutomation(ctx.tenantId, ctx.userId, parsed.data);
    if (automation.enabled && automation.kind === 'cron' && automation.cron) {
      await registerAutomationSchedule(queue, automation.id, automation.cron, automation.timezone ?? 'UTC', {
        tenantId: ctx.tenantId,
        automationId: automation.id,
        eventContext: {},
      });
    }
    return { ok: true, automation };
  });

  app.put('/api/automations/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const parsed = automationInputSchema.partial().extend({ enabled: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const automation = await updateAutomation(ctx.tenantId, id, parsed.data);
    if (!automation) {
      reply.code(404);
      return { ok: false };
    }
    if (automation.kind === 'cron' && automation.cron) {
      if (automation.enabled) {
        await registerAutomationSchedule(queue, automation.id, automation.cron, automation.timezone ?? 'UTC', {
          tenantId: ctx.tenantId,
          automationId: automation.id,
          eventContext: {},
        });
      } else {
        await unregisterAutomationSchedule(queue, automation.id);
      }
    }
    return { ok: true, automation };
  });

  app.delete('/api/automations/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const existing = await getAutomation(ctx.tenantId, id);
    if (!existing) {
      reply.code(404);
      return { ok: false };
    }
    const ok = await deleteAutomation(ctx.tenantId, id);
    if (existing.kind === 'cron') {
      await unregisterAutomationSchedule(queue, id);
    }
    return { ok };
  });

  app.post('/api/automations/:id/trigger', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const automation = await getAutomation(ctx.tenantId, id);
    if (!automation) {
      reply.code(404);
      return { ok: false };
    }
    const jobId = await dispatchAutomation(queue, {
      tenantId: ctx.tenantId,
      automationId: automation.id,
      eventContext: { manual: true },
    });
    return { ok: true, jobId };
  });

  app.get('/api/automations/:id/runs', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const automation = await getAutomation(ctx.tenantId, id);
    if (!automation) {
      reply.code(404);
      return { ok: false };
    }
    const runs = await listAutomationRuns(ctx.tenantId, id);
    return { runs };
  });

  // --- Workflow: DAG orchestration ---
  app.get('/api/workflows', async (req) => {
    const ctx = await resolveContext(req.headers);
    const workflows = await listWorkflows(ctx.tenantId, ctx.userId);
    return { workflows };
  });

  app.get('/api/workflows/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const workflow = await getWorkflow(ctx.tenantId, id);
    if (!workflow) {
      reply.code(404);
      return { ok: false };
    }
    return { workflow };
  });

  app.post('/api/workflows', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const parsed = workflowInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    try {
      const workflow = await createWorkflow(ctx.tenantId, ctx.userId, parsed.data);
      if (workflow.enabled && workflow.kind === 'cron' && workflow.cron) {
        await registerWorkflowSchedule(queue, workflow.id, workflow.cron, workflow.timezone ?? 'UTC', {
          tenantId: ctx.tenantId,
          workflowId: workflow.id,
          eventContext: {},
        });
      }
      return { ok: true, workflow };
    } catch (err) {
      if (err instanceof WorkflowNameConflictError) {
        reply.code(409);
        return { ok: false, message: err.message };
      }
      throw err;
    }
  });

  app.put('/api/workflows/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const parsed = workflowInputSchema.partial().extend({ enabled: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    try {
      const workflow = await updateWorkflow(ctx.tenantId, id, parsed.data);
      if (!workflow) {
        reply.code(404);
        return { ok: false };
      }
      if (workflow.kind === 'cron' && workflow.cron) {
        if (workflow.enabled) {
          await registerWorkflowSchedule(queue, workflow.id, workflow.cron, workflow.timezone ?? 'UTC', {
            tenantId: ctx.tenantId,
            workflowId: workflow.id,
            eventContext: {},
          });
        } else {
          await unregisterWorkflowSchedule(queue, workflow.id);
        }
      }
      return { ok: true, workflow };
    } catch (err) {
      if (err instanceof WorkflowNameConflictError) {
        reply.code(409);
        return { ok: false, message: err.message };
      }
      throw err;
    }
  });

  app.delete('/api/workflows/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const existing = await getWorkflow(ctx.tenantId, id);
    if (!existing) {
      reply.code(404);
      return { ok: false };
    }
    const ok = await deleteWorkflow(ctx.tenantId, id);
    if (existing.kind === 'cron') {
      await unregisterWorkflowSchedule(queue, id);
    }
    return { ok };
  });

  app.post('/api/workflows/:id/run', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const workflow = await getWorkflow(ctx.tenantId, id);
    if (!workflow) {
      reply.code(404);
      return { ok: false };
    }
    const jobId = await dispatchWorkflow(queue, {
      tenantId: ctx.tenantId,
      workflowId: workflow.id,
      eventContext: { manual: true },
    });
    return { ok: true, jobId };
  });

  app.get('/api/workflows/:id/runs', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const workflow = await getWorkflow(ctx.tenantId, id);
    if (!workflow) {
      reply.code(404);
      return { ok: false };
    }
    const runs = await listWorkflowRuns(ctx.tenantId, id);
    return { runs };
  });

  app.post('/api/workflows/generate', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    await applyTenantModelSettings(ctx.tenantId);
    const body = (req.body ?? {}) as { prompt?: string; currentDefinition?: unknown };
    const prompt = body.prompt?.trim();
    if (!prompt) {
      reply.code(400);
      return { ok: false, message: 'prompt is required' };
    }
    try {
      const parsed = body.currentDefinition
        ? workflowInputSchema.shape.definition.safeParse(body.currentDefinition)
        : null;
      const generated = await generateWorkflowFromPrompt(
        ctx.tenantId,
        prompt,
        parsed?.success ? parsed.data : undefined,
      );
      return { ok: true, ...generated };
    } catch (err) {
      reply.code(500);
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  // --- Automate: Webhooks ---
  app.get('/api/webhooks', async (req) => {
    const ctx = await resolveContext(req.headers);
    const baseUrl = `${req.protocol}://${req.headers.host}`;
    const endpoints = await listWebhookEndpoints(ctx.tenantId, baseUrl);
    return { endpoints };
  });

  app.post('/api/webhooks', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const baseUrl = `${req.protocol}://${req.headers.host}`;
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (body.preset === 'github') {
      const { endpoint, secret } = await createGithubWebhookEndpoint(
        ctx.tenantId,
        baseUrl,
        typeof body.name === 'string' ? body.name : 'GitHub',
      );
      return { ok: true, endpoint, secret };
    }

    const parsed = webhookCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }

    try {
      const { endpoint, secret } = await createWebhookEndpoint(ctx.tenantId, parsed.data, baseUrl);
      return { ok: true, endpoint, secret };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('unique') || message.includes('UNIQUE')) {
        reply.code(409);
        return { ok: false, message: `Webhook source '${parsed.data.source}' already exists` };
      }
      throw err;
    }
  });

  app.delete('/api/webhooks/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const ok = await deleteWebhookEndpoint(ctx.tenantId, id);
    if (!ok) {
      reply.code(404);
      return { ok: false };
    }
    return { ok: true };
  });

  app.put('/api/webhooks/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const baseUrl = `${req.protocol}://${req.headers.host}`;
    const { id } = req.params as { id: string };
    const parsed = webhookUpdateInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const endpoint = await updateWebhookEndpoint(ctx.tenantId, id, parsed.data, baseUrl);
    if (!endpoint) {
      reply.code(404);
      return { ok: false };
    }
    return { ok: true, endpoint };
  });

  app.post('/api/events/:tenantId/:source', async (req, reply) => {
    const { tenantId, source } = req.params as { tenantId: string; source: string };
    const config = await getWebhookConfig(tenantId, source.toLowerCase());
    if (!config) {
      reply.code(404);
      return { ok: false, message: `Unknown webhook source: ${source}` };
    }

    const rawBody =
      (req as typeof req & { rawBody?: Buffer }).rawBody ??
      Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
    const signature = req.headers[config.signatureHeader.toLowerCase()] as string | undefined;

    if (!verifyWebhookSignature(rawBody, signature, config.secret)) {
      reply.code(401);
      return { ok: false, message: 'invalid signature' };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      payload = { raw: rawBody.toString('utf8') };
    }

    const githubEventType = req.headers['x-github-event'] as string | undefined;
    const eventKey = resolveEventKey(config.source, payload, config.eventKeyExpr, githubEventType);
    const eventContext = buildEventContext(config.source, eventKey, payload, githubEventType);

    const automations = await listEventAutomations(tenantId, config.source);
    const matched = automations.filter((a) =>
      matchesEventTrigger(
        {
          source: a.sourceType,
          on: a.eventOn,
          filter: a.eventFilter,
        },
        config.source,
        eventKey,
        payload,
      ),
    );

    for (const automation of matched) {
      await dispatchAutomation(queue, {
        tenantId,
        automationId: automation.id,
        eventContext,
      });
    }

    const workflows = await listEventWorkflows(tenantId, config.source);
    const matchedWorkflows = workflows.filter((w) =>
      matchesEventTrigger(
        {
          source: w.sourceType,
          on: w.eventOn,
          filter: w.eventFilter,
        },
        config.source,
        eventKey,
        payload,
      ),
    );

    for (const workflow of matchedWorkflows) {
      await dispatchWorkflow(queue, {
        tenantId,
        workflowId: workflow.id,
        eventContext,
      });
    }

    return { ok: true, received: true, matched: matched.length + matchedWorkflows.length };
  });

  // Editable multi-sheet table dataset for the right-panel data grid.
  app.get('/api/table', async (req) => {
    await resolveContext(req.headers);
    const { sheet } = req.query as { sheet?: string };
    const sheetId = resolveTableSheetId(sheet);
    return {
      sheet: sheetId,
      sheets: listTableSheets(),
      defaultSheet: DEFAULT_TABLE_SHEET,
      columns: listTableColumns(sheetId),
      rows: listTableRows(sheetId),
    };
  });

  app.post('/api/table/sheets', async (req, reply) => {
    await resolveContext(req.headers);
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name?.trim()) {
      reply.code(400);
      return { ok: false, message: 'name is required' };
    }
    const sheet = createTableSheet(name);
    if (!sheet) {
      reply.code(400);
      return { ok: false, message: 'Failed to create sheet' };
    }
    return { ok: true, sheet, sheets: listTableSheets() };
  });

  app.delete('/api/table/sheets/:sheetId', async (req, reply) => {
    await resolveContext(req.headers);
    const { sheetId } = req.params as { sheetId: string };
    if (!(await deleteTableSheet(sheetId))) {
      reply.code(400);
      return { ok: false, message: 'Failed to delete sheet' };
    }
    const sheets = listTableSheets();
    const nextSheet = sheets[0]?.id ?? DEFAULT_TABLE_SHEET;
    return { ok: true, sheets, nextSheet };
  });

  app.post('/api/table/rows', async (req, reply) => {
    await resolveContext(req.headers);
    const { sheet } = (req.body ?? {}) as { sheet?: string };
    const sheetId = resolveTableSheetId(sheet);
    const row = addTableRow(sheetId);
    if (!row) {
      reply.code(400);
      return { ok: false, message: 'Failed to add row' };
    }
    return { ok: true, sheet: sheetId, row, rows: listTableRows(sheetId) };
  });

  app.delete('/api/table/rows', async (req, reply) => {
    await resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      sheet?: string;
      row_keys?: string[];
      order_nos?: string[];
    };
    const sheetId = resolveTableSheetId(body.sheet);
    const rowKeys = body.row_keys ?? body.order_nos ?? [];
    const removed = deleteTableRows(sheetId, rowKeys);
    return { ok: true, sheet: sheetId, removed, rows: listTableRows(sheetId) };
  });

  app.post('/api/table/columns', async (req, reply) => {
    await resolveContext(req.headers);
    const { sheet, name } = (req.body ?? {}) as { sheet?: string; name?: string };
    const sheetId = resolveTableSheetId(sheet);
    if (!name?.trim()) {
      reply.code(400);
      return { ok: false, message: 'name is required' };
    }
    const column = addTableColumn(sheetId, name);
    if (!column) {
      reply.code(400);
      return { ok: false, message: 'Failed to add column' };
    }
    return {
      ok: true,
      sheet: sheetId,
      column,
      columns: listTableColumns(sheetId),
      rows: listTableRows(sheetId),
    };
  });

  app.delete('/api/table/columns', async (req, reply) => {
    await resolveContext(req.headers);
    const { sheet, key } = (req.body ?? {}) as { sheet?: string; key?: string };
    const sheetId = resolveTableSheetId(sheet);
    if (!key || !deleteTableColumn(sheetId, key)) {
      reply.code(400);
      return { ok: false, message: 'Failed to delete column' };
    }
    return {
      ok: true,
      sheet: sheetId,
      columns: listTableColumns(sheetId),
      rows: listTableRows(sheetId),
    };
  });

  app.patch('/api/table', async (req, reply) => {
    await resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      sheet?: string;
      row_key?: string;
      row_id?: string;
      order_no?: string;
    } & TableRowPatch;
    const { sheet, row_key, row_id, order_no, ...patch } = body;
    const key = row_key ?? row_id ?? order_no;
    if (key == null || key === '') {
      reply.code(400);
      return { ok: false, message: 'row_key is required' };
    }
    const sheetId = resolveTableSheetId(sheet);
    const row = await updateTableRow(key, patch, sheetId);
    if (!row) {
      reply.code(404);
      return { ok: false, message: 'Row not found' };
    }
    return { ok: true, sheet: sheetId, row };
  });

  app.post('/api/table/import', async (req, reply) => {
    await resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      sheet?: string;
      rows?: TableRowPatch[];
      new_column_names?: string[];
    };
    const sheetId = resolveTableSheetId(body.sheet);
    if (!Array.isArray(body.rows)) {
      reply.code(400);
      return { ok: false, message: 'rows is required' };
    }
    const result = importTableSheet(
      sheetId,
      body.rows,
      body.new_column_names ?? [],
    );
    if (!result) {
      reply.code(400);
      return { ok: false, message: 'Import failed' };
    }
    return {
      ok: true,
      sheet: sheetId,
      columns: result.columns,
      rows: result.rows,
    };
  });

  // Checkpoints removed — edit/compact rewind replaces manual snapshots.

  // Tasks: list/get for the UI task panel.
  app.get('/api/tasks', async (req) => {
    const ctx = await resolveContext(req.headers);
    const { threadId } = req.query as { threadId?: string };
    if (!threadId) return { tasks: [] };
    const row = await resolveThreadForRead(threadId, ctx);
    if (!row) return { tasks: [] };
    const rows = await listTasksByParentThread(threadId);
    return { tasks: rows };
  });

  app.get('/api/todos', async (req) => {
    const ctx = await resolveContext(req.headers);
    const { threadId } = req.query as { threadId?: string };
    if (!threadId) return { todos: [] };
    const row = await resolveThreadForRead(threadId, ctx);
    return { todos: row?.todos ?? [] };
  });

  app.get('/api/threads', async (req) => {
    const ctx = await resolveContext(req.headers);
    const threads = await listThreadsForResource(
      ctx.tenantId,
      ctx.userId,
      runtime.memory,
    );
    return { threads };
  });

  app.get('/api/threads/activity', async (req) => {
    const ctx = await resolveContext(req.headers);
    const activity = await listThreadActivity(ctx.tenantId, ctx.userId, runtime.memory);
    return { activity };
  });

  app.get('/api/threads/:threadId', async (req, reply) => {
    const { threadId } = req.params as { threadId: string };
    const ctx = await resolveContext(req.headers);
    const state = await getThreadState(threadId);
    if (state) {
      try {
        await requireThreadOwnership(threadId, ctx);
      } catch (err) {
        if (isForbiddenError(err)) return reply.status(403).send({ error: 'forbidden' });
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
    const ctx = await resolveContext(req.headers);
    await ensureThreadState({ threadId, tenantId: ctx.tenantId, resourceId: ctx.userId });
    if (typeof body.title === 'string') {
      await setThreadTitle(threadId, body.title);
    }
    return { ok: true, title: body.title ?? null };
  });

  app.post('/api/threads/:threadId/generate-title', async (req) => {
    const { threadId } = req.params as { threadId: string };
    const body = (req.body ?? {}) as { messages?: unknown[] };
    const ctx = await resolveContext(req.headers);
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
    const ctx = await resolveContext(req.headers);
    try {
      await requireThreadOwnership(threadId, ctx);
    } catch (err) {
      if (isForbiddenError(err)) return reply.status(403).send({ error: 'forbidden' });
      throw err;
    }
    await deleteThreadState(threadId);
    return { ok: true };
  });

  app.get('/api/threads/:threadId/state', async (req) => {
    const { threadId } = req.params as { threadId: string };
    const ctx = await resolveContext(req.headers);
    const state =
      (await getThreadState(threadId)) ??
      (await ensureThreadState({ threadId, tenantId: ctx.tenantId, resourceId: ctx.userId }));
    return { state };
  });

  app.get('/api/threads/:threadId/messages', async (req) => {
    const { threadId } = req.params as { threadId: string };
    const ctx = await resolveContext(req.headers);
    const row = await resolveThreadForRead(threadId, ctx);
    if (!row) {
      return { messages: [] };
    }
    const recalled = await runtime.memory.recall({
      threadId,
      resourceId: row.resourceId,
      perPage: false,
    });
    return { messages: mastraMessagesToUi(recalled.messages ?? []) };
  });

  app.get('/api/plan-mode', async (req) => {
    const { threadId } = req.query as { threadId?: string };
    if (!threadId) return { planMode: false };
    const ctx = await resolveContext(req.headers);
    const row = await resolveThreadForRead(threadId, ctx);
    return { planMode: row?.planMode ?? false };
  });

  app.post('/api/plan-mode', async (req) => {
    const body = req.body as { threadId?: string; planMode?: boolean };
    const ctx = await resolveContext(req.headers);
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

  app.post('/api/compact', async (req) => {
    const query = req.query as { threadId?: string; model?: string };
    const { threadId } = query;
    if (!threadId) return { ok: false, error: 'threadId required' };
    try {
      const ctx = await resolveContext(req.headers);
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

      const recalled = await runtime.memory.recall({
        threadId,
        resourceId: threadRow.resourceId,
        perPage: false,
      });
      const stored = recalled?.messages ?? [];
      const modelKey = (query.model ?? 'default') as ModelKey;
      const compressor = new ContextCompression({
        summarizer: buildSummarizer(modelKey),
      });
      const compacted = await compressor.processInput({ messages: stored });
      const uiMessages = mastraMessagesToUi(
        compacted as Array<{ id?: string; role?: string; content?: { parts?: unknown[] } }>,
      );

      await syncThreadMessagesFromClient({
        memory: runtime.memory,
        identity,
        clientMessages: uiMessages,
        branchEdit: true,
      });

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

  app.post('/api/resume', async (req) => {
    const ctx = await resolveContext(req.headers);
    await applyTenantModelSettings(ctx.tenantId);
    const body = req.body as { runId?: string; resumeData?: unknown; agentId?: string };
    const agent = runtime.getAgent(body.agentId ?? DEFAULT_AGENT_ID) as unknown as {
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

    const ctx = await resolveContext(req.headers);
    await applyTenantModelSettings(ctx.tenantId);
    await ensureMcpForTenant(ctx.tenantId);
    const threadId = body.id ?? body.threadId ?? `thread-${ctx.userId}`;
    const agentId = body.agentId ?? DEFAULT_AGENT_ID;
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

    await touchThreadActivity(threadId);
    await restoreTodosFromHistoryIfEmpty(threadId, messages as never);

    let threadRowState = threadRow;
    if (body.planMode === true) {
      await setThreadPlanModeDb(threadId, true);
      setThreadPlanMode(threadId, true);
      threadRowState = (await getThreadState(threadId)) ?? threadRow;
    } else if (body.planMode === false) {
      await setThreadPlanModeDb(threadId, false);
      setThreadPlanMode(threadId, false);
      threadRowState = (await getThreadState(threadId)) ?? threadRow;
    }

    const planMode = body.planMode === true || (threadRowState?.planMode ?? false);

    await refreshAgentPackages(runtime);
    const agent = requireAgent(runtime, agentId);
    const modelKey = (body.model ?? 'default') as ModelKey;
    const modelConfig = getModelConfig(modelKey);
    if (!modelConfig.apiKey.trim()) {
      return reply.status(400).send({
        error: 'model_not_configured',
        message: 'Model API key is not configured. Open Settings -> Models and add your own API key.',
      });
    }

    const mcpAgentId = agentId;
    const declaredMcp = runtime.definitions.get(mcpAgentId)?.definition.mcpServers ?? [];
    const mcpEnabled = body.mcpEnabled as Record<string, boolean> | undefined;
    const tenantActiveMcp = await listActiveMcpServerNames(ctx.tenantId, declaredMcp);
    const activeMcp = tenantActiveMcp.filter(
      (server) => mcpEnabled == null || mcpEnabled[server] !== false,
    );

    const mergedSkills = await listMergedSkills(runtime, ctx.tenantId, agentId);
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
    requestContext.set('mcpToolNames', mcpToolIndex);
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
      const content = await resolveSkillContent(runtime, ctx.tenantId, agentId, name);
      if (!content) return;
      const skills = await activateSkill(threadId, name, content);
      await syncWorkingMemory(runtime.memory, identity, skills, threadRowState?.workingMemory ?? null);
    });
    requestContext.set('enabledSkillNames', enabledSkillNames);
    requestContext.set(
      'resolveSkillByName',
      async (name: string) => resolveSkillContent(runtime, ctx.tenantId, agentId, name),
    );
    if (body.model) requestContext.set('model', body.model);

    if (body.pendingSkill) {
      const content = await resolveSkillContent(
        runtime,
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
          runtime.memory,
          identity,
          skills,
          threadRowState.workingMemory ?? null,
        );
      }
    }

    let skillBlock = getSkillMemoryBlock(threadRowState?.activatedSkills ?? {});

    await syncThreadMessagesFromClient({
      memory: runtime.memory,
      identity,
      clientMessages: messages as never,
      branchEdit: body.branchEdit,
    });

    // Per-agent MCP: only expose declared servers; none when undeclared.
    const agentMcp =
      planMode
        ? {}
        : activeMcp.length > 0
          ? Object.fromEntries(
              Object.entries(mcpToolsets).filter(([server]) => activeMcp.includes(server)),
            )
          : {};

    const effectiveModel = body.model ?? runtime.definitions.get(agentId)?.definition.model;
    let agentMessages = await toAgentMessages(messages, modelSupportsImages(effectiveModel));

    const rules = await listRules(ctx.tenantId, ctx.userId, agentId);
    const rulesBlock = buildRulesMemoryBlock(rules, lastUserText(messages));
    const skillsCatalog = buildSkillsCatalogBlock(mergedSkills);
    const reminderBlock = buildReminderBlock({
      todos: threadRowState?.todos ?? [],
      lastUserText: lastUserText(messages),
      todosUpdatedAt: threadRowState?.updatedAt,
    });
    // Live knowledge-base awareness: only when the main (full-toolset) agent has
    // knowledge_search available and not in plan mode (tools disabled there).
    const knowledgeCapable =
      !planMode && runtime.definitions.get(agentId)?.definition.fullToolset === true;
    const knowledgeBlock = knowledgeCapable
      ? await buildKnowledgeContextBlock(ctx.tenantId)
      : '';
    const localeBlock = buildLocaleBlock(body.locale);
    const attachedBrowserBlock = buildAttachedBrowserBlock(body.attachedBrowser);
    const agentDefForBlocks = runtime.definitions.get(agentId)?.definition;
    const fullToolset = agentDefForBlocks?.fullToolset === true;
    const coordinatorMode = isCoordinatorMode() && !planMode && fullToolset;
    const orchestrationBlock =
      !planMode && fullToolset
        ? coordinatorMode
          ? buildCoordinatorOrchestrationBlock(listDispatchableCustomAgentIds(runtime, agentId))
          : buildAgentOrchestrationBlock(listDispatchableCustomAgentIds(runtime, agentId))
        : '';
    const systemBlocks = [skillsCatalog, skillBlock, rulesBlock, knowledgeBlock, reminderBlock, orchestrationBlock, localeBlock, attachedBrowserBlock]
      .filter(Boolean)
      .join('\n\n');
    if (systemBlocks) {
      agentMessages = [{ role: 'system', content: systemBlocks } as never, ...agentMessages];
    }

    const discoveredIds = (requestContext.get('discoveredToolIds') as string[]) ?? [];
    const agentDef = runtime.definitions.get(agentId)?.definition;
    const declaredBuiltinTools = agentDef?.tools ?? [];
    const activeToolsets = planMode
      ? {}
      : coordinatorMode
        ? { agent: taskToolset.agent }
        : fullToolset
          ? {
              ...agentMcp,
              ...taskToolset,
            }
          : {
              ...filterExternalToolsets(
                agentMcp,
                taskToolset,
                discoveredIds,
                declaredMcp,
                declaredBuiltinTools,
              ),
              ...(taskToolset.table ? { table: taskToolset.table } : {}),
            };
    const stream = await agent.stream(agentMessages as never, {
      memory: { thread: threadId, resource: ctx.userId },
      requestContext,
      toolsets: activeToolsets,
    } as never);

    const streamId = crypto.randomUUID();
    await bindActiveStream(threadId, streamId);
    const runAbort = createRunAbortController(streamId);
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
        scheduleDreamConsolidation(runtime, identity);
      },
      execute: async ({ writer }) => {
        try {
          for await (const part of toAISdkStream(stream as never, {
            from,
            version: 'v6',
            sendReasoning: true,
          } as never)) {
            if (runAbort.signal.aborted) break;
            writer.write(part as never);
          }
        } finally {
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
    const ctx = await resolveContext(req.headers);
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
    const ctx = await resolveContext(req.headers);
    try {
      await requireThreadOwnership(threadId, ctx);
    } catch (err) {
      if (isForbiddenError(err)) return reply.status(403).send({ error: 'forbidden' });
      throw err;
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
      return reply.status(404).send({ error: 'stream not found' });
    }

    reply.hijack();
    reply.raw.writeHead(resumed.status, Object.fromEntries(resumed.headers));
    Readable.fromWeb(resumed.body as never).pipe(reply.raw);
  });

  // Approval resume seam: the frontend posts the decision for a suspended run.
  app.post('/api/approve', async (req) => {
    const ctx = await resolveContext(req.headers);
    await applyTenantModelSettings(ctx.tenantId);
    const body = req.body as { runId: string; approved: boolean; answer?: string[] };
    await refreshAgentPackages(runtime);
    const agent = requireAgent(runtime, 'veylin') as unknown as {
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

  // Connect MCP servers; expose their tools to chat as a toolset.
  await rebuildMcp(DEV_TENANT_ID);

  const tableTools = buildTableTools();
  const workspaceConfig = buildWorkspaceConfigTool({
    runtime,
    queue,
    onMcpRebuild: rebuildMcp,
  });
  const workflowTools = buildWorkflowTools(queue);
  const agentTaskTools = buildAgentTaskTools(runtime, { queue, mcpToolsets });
  taskToolset = {
    agent: agentTaskTools,
    table: tableTools,
    knowledge: { knowledge_search: buildKnowledgeSearchTool() },
    config: { workspace_config: workspaceConfig },
    workflow: workflowTools,
  };

  await registerWorkers(queue, async (job: SubagentJob) => {
    await refreshAgentPackages(runtime);
    try {
      await applyTenantModelSettings(job.tenantId);
      await ensureMcpForTenant(job.tenantId);
      await executeSubagentJob(runtime, { mcpToolsets }, job);
    } catch (err) {
      if (err instanceof CancelledTaskError) return;
      throw err;
    }
  });

  await registerAutomationWorkers(queue, async (job: AutomationJob) => {
    await runAutomationJob(runtime, job);
  });

  await registerWorkflowWorkers(queue, async (job: WorkflowJob) => {
    await runWorkflowJob(runtime, job);
  });

  const dbAutomations = await listAllCronAutomations();
  for (const a of dbAutomations) {
    await registerAutomationSchedule(queue, a.id, a.cron!, a.timezone ?? 'UTC', {
      tenantId: a.tenantId,
      automationId: a.id,
      eventContext: {},
    });
  }
  if (dbAutomations.length > 0) {
    app.log.info(`registered ${dbAutomations.length} DB automation schedule(s) across all tenants`);
  }

  const dbWorkflows = await listAllCronWorkflows();
  for (const w of dbWorkflows) {
    await registerWorkflowSchedule(queue, w.id, w.cron!, w.timezone ?? 'UTC', {
      tenantId: w.tenantId,
      workflowId: w.id,
      eventContext: {},
    });
  }
  if (dbWorkflows.length > 0) {
    app.log.info(`registered ${dbWorkflows.length} DB workflow schedule(s) across all tenants`);
  }

  app.post('/api/subagent', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const job = req.body as SubagentJob;
    if (job.tenantId !== ctx.tenantId) {
      return reply.status(403).send({ error: 'forbidden' });
    }
    const id = await queue.send(SUBAGENT_QUEUE, job);
    return { ok: true, jobId: id };
  });

  // Cron schedules declared in agent.yaml (M4).
  const schedules: ScheduleSpec[] = [];
  for (const { definition } of runtime.definitions.values()) {
    for (const s of definition.schedules ?? []) {
      schedules.push({
        name: `${definition.id}:${s.name}`,
        cron: s.cron,
        job: {
          tenantId: DEV_TENANT_ID,
          threadId: `cron-${definition.id}-${s.name}`,
          agentId: definition.id,
          prompt: s.prompt,
          label: `cron:${s.name}`,
        },
      });
    }
  }
  if (schedules.length > 0) {
    await registerSchedules(queue, schedules);
    app.log.info(`registered ${schedules.length} cron schedule(s)`);
  }

  app.get('/api/rag/documents', async (req) => {
    const ctx = await resolveContext(req.headers);
    const documents = await listKnowledgeDocuments(ctx.tenantId);
    return { documents };
  });

  app.post('/api/rag/extract-pdf', async (req, reply) => {
    await resolveContext(req.headers);
    const buffer = req.body as Buffer | undefined;
    if (!buffer?.length) {
      reply.code(400);
      return { ok: false, message: 'empty body' };
    }
    if (buffer.length > RAG_UPLOAD_MAX_BYTES) {
      reply.code(413);
      return { ok: false, message: `PDF exceeds ${RAG_UPLOAD_MAX_BYTES} byte upload limit` };
    }
    try {
      const text = await extractPdfText(new Uint8Array(buffer));
      return { ok: true, text };
    } catch (err) {
      reply.code(422);
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post('/api/rag/documents', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const body = req.body as { filename: string; text: string; mimeType?: string };
    const textBytes = Buffer.byteLength(body.text ?? '', 'utf8');
    if (textBytes > RAG_UPLOAD_MAX_BYTES) {
      reply.code(413);
      return { ok: false, message: `document text exceeds ${RAG_UPLOAD_MAX_BYTES} byte upload limit` };
    }
    const result = await ingestDocumentText(ctx.tenantId, body.filename, body.text, body.mimeType);
    return { ok: true, ...result };
  });

  app.delete('/api/rag/documents/:id', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const id = (req.params as { id: string }).id;
    const ok = await removeKnowledgeDocument(ctx.tenantId, id);
    if (!ok) {
      reply.code(404);
      return { ok: false, message: 'document not found' };
    }
    return { ok: true };
  });

  app.get('/api/rag/references', async (req) => {
    const ctx = await resolveContext(req.headers);
    return { references: getLastKnowledgeReferences(ctx.tenantId) };
  });

  app.post('/api/rag/search', async (req, reply) => {
    const ctx = await resolveContext(req.headers);
    const body = (req.body ?? {}) as { query?: string };
    const query = body.query?.trim();
    if (!query) {
      reply.code(400);
      return { ok: false, message: 'query is required' };
    }
    const result = await searchKnowledge(ctx.tenantId, query);
    return { ok: true, ...result };
  });

  app.get('/api/kg', async (req) => {
    const ctx = await resolveContext(req.headers);
    const graph = await listGraphForTenant(ctx.tenantId);
    return {
      entities: graph.entities.map((e) => ({ id: e.id, name: e.name, type: e.type })),
      edges: graph.edges.map((e) => ({
        source: e.fromEntityId,
        target: e.toEntityId,
        relation: e.relation,
      })),
    };
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`veylin server on :${PORT}`);
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
