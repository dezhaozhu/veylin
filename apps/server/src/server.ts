import './env';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPClient } from '@mastra/mcp';
import { createRuntime } from '@veylin/runtime';
import { toNodeHandler } from 'better-auth/node';
import { auth, assertHostedAuthConfig, isDesktopAuth } from './auth';
import {
  createInProcQueue,
  registerWorkers,
  registerSchedules,
  registerAutomationWorkers,
  registerAutomationSchedule,
  registerWorkflowWorkers,
  registerWorkflowSchedule,
  type SubagentJob,
  type ScheduleSpec,
  type AutomationJob,
  type WorkflowJob,
} from './queue';
import { buildAgentTaskTools } from './agent-task-tool';
import { executeSubagentJob, CancelledTaskError } from './agent-task-runner';
import { buildTableTools } from './table-tools';
import { buildViewer3dTools } from './viewer3d-tools';
import { initTableStore } from './table-store';
import { pruneDesktopThreadClutter } from './thread-state';
import {
  initResumableChatStreams,
  waitForActiveChatDrain,
} from './resumable-chat-stream';
import { subscribeTaskEvents } from './task-events';
import { buildMcpHealthSnapshot, type McpHealthSnapshot } from './mcp-health';
import { startupCheckpoint } from './startup-profiler';
import { ensureDevTenant, DEV_TENANT_ID } from './tenant';
import { refreshAgentPackages } from './agent-packages-sync';
import { createMcpClient, listActiveMcpServerNames, sanitizeMcpToolsets } from './mcp-store';
import { listAllCronAutomations } from './automation-store';
import { runAutomationJob } from './automation-worker';
import { buildWorkspaceConfigTool } from './workspace-config-tool';
import { listAllCronWorkflows, sweepInterruptedWorkflowRuns } from './workflow-store';
import { runWorkflowJob } from './workflow-runner';
import { ensureEmbeddingModelOnStartup } from './embedding-service';
import { buildWorkflowTools } from './workflow-tools';
import { applyTenantModelSettings } from './model-settings-store';
import { buildKnowledgeSearchTool } from './rag-store';
import { RAG_UPLOAD_MAX_BYTES } from './rag-limits';
import {
  connectDb,
  closeDb,
  ensureDataDir,
  mastraLibsqlUrl,
} from '@veylin/db';
import {
  resolveContext,
  isForbiddenError,
  UnauthorizedError,
} from './server-context.js';
import { registerApiRoutes } from './routes/index.js';
import { createReadTaskSnapshot } from './routes/threads.js';

const DATA_DIR = ensureDataDir();
const PORT = Number(process.env.PORT ?? 8787);
const LISTEN_HOST = process.env.HOST ?? '127.0.0.1';

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

async function main() {
  assertHostedAuthConfig();
  startupCheckpoint('boot_start');
  await connectDb();
  startupCheckpoint('db_connected');
  const interruptedRuns = await sweepInterruptedWorkflowRuns();
  if (interruptedRuns > 0) {
    console.info(`[workflow] marked ${interruptedRuns} interrupted run(s) as failed`);
  }
  await initResumableChatStreams();
  await initTableStore();
  await ensureDevTenant();

  console.info('[veylin] VEYLIN_DATA_DIR=%s', DATA_DIR);
  ensureEmbeddingModelOnStartup();

  let mcp: MCPClient | null = null;
  let mcpToolsets: Record<string, unknown> = {};
  let mcpToolIndex: { id: string; description: string }[] = [];
  const mcpCacheByTenant = new Map<
    string,
    { toolsets: Record<string, unknown>; index: { id: string; description: string }[] }
  >();
  const mcpHealthByTenant = new Map<string, McpHealthSnapshot>();
  let taskToolset: Record<string, unknown> = {};

  async function rebuildMcp(tenantId: string) {
    const activeNames = await listActiveMcpServerNames(tenantId);
    let listError: string | undefined;
    try {
      mcp = await createMcpClient(tenantId);
      try {
        mcpToolsets = sanitizeMcpToolsets((await mcp.listToolsets()) as Record<string, unknown>);
      } catch (err) {
        listError = err instanceof Error ? err.message : String(err);
        mcpToolsets = {};
      }
    } catch (err) {
      listError = err instanceof Error ? err.message : String(err);
      mcpToolsets = {};
    }
    mcpToolIndex = indexMcpTools(mcpToolsets);
    mcpCacheByTenant.set(tenantId, { toolsets: mcpToolsets, index: mcpToolIndex });
    const health = buildMcpHealthSnapshot(activeNames, mcpToolsets, listError);
    mcpHealthByTenant.set(tenantId, health);
    if (listError) {
      console.warn(`[mcp] listToolsets failed for tenant ${tenantId}: ${listError}`);
    }
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

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof UnauthorizedError) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized' });
    }
    app.log.error(err);
    return reply.code(500).send({ ok: false, message: 'Internal server error' });
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

  const readTaskSnapshot = createReadTaskSnapshot(runtime);
  const deps = {
    runtime,
    queue,
    resolveContext,
    isForbiddenError,
    rebuildMcp,
    ensureMcpForTenant,
    getMcpToolsets: () => mcpToolsets,
    getMcpToolIndex: () => mcpToolIndex,
    getTaskToolset: () => taskToolset,
    readTaskSnapshot,
    subscribeTaskEvents,
    mcpHealthByTenant,
    RAG_UPLOAD_MAX_BYTES,
  };
  await registerApiRoutes(app, deps);

  // Connect MCP servers; expose their tools to chat as a toolset.
  await rebuildMcp(DEV_TENANT_ID);

  const tableTools = buildTableTools(() => mcpToolsets);
  const viewer3dTools = buildViewer3dTools();
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
    viewer3d: viewer3dTools,
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

  await app.listen({ port: PORT, host: LISTEN_HOST });
  startupCheckpoint('listen_ready');
  app.log.info(`veylin server on ${LISTEN_HOST}:${PORT}`);

  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Shutting down (${signal})…`);
    try {
      await queue.stop();
      await waitForActiveChatDrain(Number(process.env.SHUTDOWN_DRAIN_MS ?? 30_000));
      await closeDb();
      await app.close();
    } catch (err) {
      app.log.error(err, 'graceful shutdown error');
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
