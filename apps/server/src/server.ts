import './env';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPClient } from '@mastra/mcp';
import { createRuntime } from '@veylin/runtime';
import { assertHostedAuthConfig, isDesktopAuth } from './auth';
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
import { initTableStore, listTableSheets, stampTableSheetSource } from './table-store';
import { pruneDesktopThreadClutter } from './thread-state';
import {
  initResumableChatStreams,
  waitForActiveChatDrain,
} from './resumable-chat-stream';
import { subscribeTaskEvents } from './task-events';
import { buildMcpHealthSnapshot, type McpHealthSnapshot } from './mcp-health';
import { createMcpAutoRetryLoop, isMcpAutoRetryEnabled } from './mcp-retry-loop';
import {
  createCompassIdentitySyncLoop,
  isCompassIdentitySyncEnabled,
  parseCompassIdentityConfig,
  reconcileCompassIdentity,
} from './compass-identity';
import { startupCheckpoint } from './startup-profiler';
import { ensureDevTenant, DEV_TENANT_ID } from './tenant';
import { refreshAgentPackages, isAgentHotReloadEnabled } from './agent-packages-sync';
import {
  createMcpClient,
  createRemoteMcpServer,
  listActiveMcpServerNames,
  listMcpServerGroups,
  listRemoteMcpServers,
  sanitizeMcpToolsets,
  seedMcpServersFromEnvIfMissing,
  updateRemoteMcpServer,
} from './mcp-store';
import { invalidateCompassPool } from './compass-pool';
import { createProject, listProjects, updateProject } from './project-store';
import { runProjectMigration } from './project-migration';
import { listAllCronAutomations, sweepInterruptedAutomationRuns } from './automation-store';
import { runAutomationJob } from './automation-worker';
import { buildWorkspaceConfigTool } from './workspace-config-tool';
import { listAllCronWorkflows, sweepInterruptedWorkflowRuns } from './workflow-store';
import { runWorkflowJob } from './workflow-runner';
import { ensureEmbeddingModelOnStartup } from './embedding-service';
import { buildWorkflowTools } from './workflow-tools';
import { applyTenantModelSettings, seedModelSettingsFromEnvIfEmpty } from './model-settings-store';
import {
  bindLangfuseRuntime,
  seedLangfuseSettingsFromEnvIfEmpty,
} from './langfuse-settings-store';
import { buildKnowledgeSearchTool, sweepInterruptedRagIngests } from './rag-store';
import { registerPluginProviders } from './plugin-store';
import { RAG_UPLOAD_MAX_BYTES } from './rag-limits';
import {
  connectDb,
  closeDb,
  ensureDataDir,
  mastraLibsqlUrl,
  listThreadStatesWithProject,
  updateThreadStateProjectBulk,
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

function isLazyMcpBoot(): boolean {
  return process.env.VEYLIN_LAZY_MCP_BOOT === '1';
}

function resolveCorsOrigin(): boolean | string | string[] {
  if (isDesktopAuth) return true;
  const raw = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (!raw) return true;
  const origins = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (origins.length === 0) return true;
  if (origins.length === 1) return origins[0]!;
  return origins;
}

async function listenWithRetry(
  app: Awaited<ReturnType<typeof Fastify>>,
  port: number,
  host: string,
): Promise<void> {
  const retries = Number(process.env.VEYLIN_LISTEN_RETRIES ?? 5);
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await app.listen({ port, host });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EADDRINUSE' || attempt >= retries - 1) throw err;
      const delayMs = 400 * (attempt + 1);
      console.warn(`[server] port ${port} in use, retry in ${delayMs}ms (${attempt + 1}/${retries})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

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
  const interruptedAutomations = await sweepInterruptedAutomationRuns();
  if (interruptedAutomations > 0) {
    console.info(`[automation] marked ${interruptedAutomations} interrupted run(s) as failed`);
  }
  const interruptedRag = await sweepInterruptedRagIngests();
  if (interruptedRag > 0) {
    console.info(`[rag] marked ${interruptedRag} interrupted ingest(s) as failed`);
  }
  await initResumableChatStreams();
  await initTableStore();
  await ensureDevTenant();
  await seedModelSettingsFromEnvIfEmpty(DEV_TENANT_ID);
  registerPluginProviders();

  console.info('[veylin] VEYLIN_DATA_DIR=%s', DATA_DIR);
  ensureEmbeddingModelOnStartup();

  let mcp: MCPClient | null = null;
  let mcpToolsets: Record<string, unknown> = {};
  let mcpToolIndex: { id: string; description: string }[] = [];
  // Server-name → project-group map for whichever tenant's toolsets are
  // currently live in `mcpToolsets` — refreshed alongside it so
  // resolveCompassServer (schedule-edit.ts / table-tools.ts / routes/tables.ts)
  // always sees groups that match. Same single-active-tenant-in-process
  // characteristic as `mcpToolsets` itself (pre-existing, not introduced here).
  let mcpGroups: Record<string, string | undefined> = {};
  const mcpCacheByTenant = new Map<
    string,
    {
      toolsets: Record<string, unknown>;
      index: { id: string; description: string }[];
      groups: Record<string, string | undefined>;
    }
  >();
  const mcpHealthByTenant = new Map<string, McpHealthSnapshot>();
  let taskToolset: Record<string, unknown> = {};

  async function rebuildMcp(tenantId: string) {
    const activeNames = await listActiveMcpServerNames(tenantId);
    // Keep the previous good toolsets when a rebuild fails or stalls: one
    // misbehaving remote server must not wipe (or block) every other server's
    // tools for the whole process. @mastra already isolates per-server connect
    // failures inside listToolsets(); this guard covers total failures and
    // pathological servers that hang past the SDK's own timeouts.
    const previous = mcpCacheByTenant.get(tenantId);
    let listError: string | undefined;
    mcpCacheByTenant.delete(tenantId);
    // The compass entry's url/token may be what changed (reconnect route,
    // compass-identity adopt) — pooled compass connections must not outlive a
    // rebuild. Compass itself never enters the generic client below
    // (buildMcpServerConfigs skips COMPASS_IDENTITY_GROUP); connections are
    // re-established lazily by the pool on the next pinned request.
    await invalidateCompassPool(tenantId);
    try {
      if (mcp) {
        await mcp.disconnect().catch(() => undefined);
        mcp = null;
      }
      mcp = await createMcpClient(tenantId);
      const listed = (await Promise.race([
        mcp.listToolsets(),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('listToolsets timed out after 15s')), 15_000),
        ),
      ])) as Record<string, unknown>;
      mcpToolsets = sanitizeMcpToolsets(listed);
    } catch (err) {
      listError = err instanceof Error ? err.message : String(err);
      mcpToolsets = previous ? previous.toolsets : {};
    }
    mcpToolIndex = indexMcpTools(mcpToolsets);
    try {
      mcpGroups = await listMcpServerGroups(tenantId);
    } catch (err) {
      mcpGroups = previous ? previous.groups : {};
      console.warn(`[mcp] listMcpServerGroups failed for tenant ${tenantId}: ${String(err)}`);
    }
    mcpCacheByTenant.set(tenantId, { toolsets: mcpToolsets, index: mcpToolIndex, groups: mcpGroups });
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
      mcpGroups = cached.groups;
      return;
    }
    await rebuildMcp(tenantId);
  }

  // Absent (or malformed) VEYLIN_COMPASS_IDENTITY → feature off, byte-identical
  // to today's behavior (no compass-identity route/loop wiring does anything).
  const compassIdentityConfig = parseCompassIdentityConfig();
  const compassIdentitySyncOn = compassIdentityConfig != null && isCompassIdentitySyncEnabled();

  async function syncCompassIdentity(tenantId: string) {
    if (!compassIdentityConfig) {
      return {
        created: 0,
        adopted: 0,
        disabled: 0,
        unchanged: 0,
        projectsCreated: 0,
        projectsEnabled: 0,
        projectsDisabled: 0,
      };
    }
    return reconcileCompassIdentity({
      tenantId,
      config: compassIdentityConfig,
      listRemoteMcpServers,
      createRemoteMcpServer,
      updateRemoteMcpServer,
      rebuildMcp,
      listProjects,
      createProject,
      updateProject,
      // Grant/token changes drop the tenant's pooled compass connections —
      // covers project-only changes too (entry changes already invalidate via
      // rebuildMcp above).
      invalidateCompassPool,
    });
  }

  // Legacy entry-name pins/provenance → project ids (Phase B Task 3). Runs at
  // boot strictly AFTER the first compass-identity reconcile pass — default
  // projects must exist for anything to map — and is idempotent (later boots
  // find nothing, or pick up pins whose source got re-granted since). A throw
  // must never take the boot down: log and retry on the next boot.
  async function migrateProjectPins(tenantId: string) {
    try {
      await runProjectMigration({
        tenantId,
        listProjects,
        createProject,
        listPinnedThreadStates: listThreadStatesWithProject,
        updateThreadStateProjectBulk,
        listSheets: listTableSheets,
        stampSheetSource: stampTableSheetSource,
      });
    } catch (err) {
      console.warn(
        `[project-migration] tenant=${tenantId} failed (will retry next boot): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
  bindLangfuseRuntime(runtime.mastra);
  await seedLangfuseSettingsFromEnvIfEmpty(DEV_TENANT_ID);
  app.log.info(
    {
      agentsDir: AGENTS_DIR,
      hotReloadAgents: isAgentHotReloadEnabled(),
    },
    isAgentHotReloadEnabled()
      ? 'agent packages reload on each customize/chat request'
      : 'agent packages loaded at startup (set VEYLIN_HOT_RELOAD_AGENTS=1 to reload on chat)',
  );
  const queue = createInProcQueue();
  await queue.start();

  await app.register(cors, {
    origin: resolveCorsOrigin(),
    credentials: true,
  });

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  const identityProvider = (
    isDesktopAuth ? 'desktop' : process.env.IDENTITY_PROVIDER?.trim() || 'local'
  ).toLowerCase();

  if (!isDesktopAuth && identityProvider === 'local') {
    const { initLocalPasswordAuth, toNodeHandler: authNodeHandler } = await import('./auth-local.js');
    const handle = initLocalPasswordAuth();
    await app.register(async (authScope) => {
      authScope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
        done(null, body);
      });
      authScope.route({
        method: ['GET', 'POST'],
        url: '/api/auth/*',
        handler: async (req, reply) => {
          reply.hijack();
          await authNodeHandler(handle as never)(req.raw, reply.raw);
        },
      });
    });
  } else if (!isDesktopAuth) {
    // oidc/webhook: no better-auth routes; IdentityPort handles getSession.
    console.info(`[auth] IDENTITY_PROVIDER=${identityProvider} (no local /api/auth routes)`);
  }

  // Warm enterprise ports after auth is ready
  const { getEnterprisePorts } = await import('./ports/index.js');
  getEnterprisePorts();

  const readTaskSnapshot = createReadTaskSnapshot(runtime);
  const deps = {
    runtime,
    queue,
    resolveContext,
    isForbiddenError,
    rebuildMcp,
    ensureMcpForTenant,
    getMcpToolsets: () => mcpToolsets,
    getMcpGroups: () => mcpGroups,
    getMcpToolIndex: () => mcpToolIndex,
    getTaskToolset: () => taskToolset,
    readTaskSnapshot,
    subscribeTaskEvents,
    mcpHealthByTenant,
    RAG_UPLOAD_MAX_BYTES,
    syncCompassIdentity: compassIdentityConfig
      ? () => syncCompassIdentity(DEV_TENANT_ID)
      : undefined,
  };
  await registerApiRoutes(app, deps);

  // Self-heals a remote MCP server left disconnected after boot/reconnect
  // (e.g. an ssh tunnel blip during mac sleep) by periodically re-running the
  // same rebuildMcp path the manual /api/mcp-servers/reconnect route uses —
  // per-tenant, with exponential backoff. Built once per process; started
  // below, right after the first tenant's MCP init is kicked off.
  const mcpAutoRetryLoop = createMcpAutoRetryLoop({ mcpHealthByTenant, rebuildMcp });

  // Auto-materializes compass-<source> MCP server entries from the account's
  // /my/sources grants (see compass-identity.ts). Built once per process
  // regardless of the kill switch; started conditionally below alongside the
  // self-heal loop, right after the first tenant's MCP init is kicked off.
  const compassIdentitySyncLoop = createCompassIdentitySyncLoop({
    sync: () => syncCompassIdentity(DEV_TENANT_ID),
  });

  await seedMcpServersFromEnvIfMissing(DEV_TENANT_ID);
  // Connect MCP servers; expose their tools to chat as a toolset.
  if (!isLazyMcpBoot()) {
    await rebuildMcp(DEV_TENANT_ID);
  }

  const tableTools = buildTableTools(() => mcpToolsets, () => mcpGroups);
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

  await listenWithRetry(app, PORT, LISTEN_HOST);
  startupCheckpoint('listen_ready');
  app.log.info(`veylin server on ${LISTEN_HOST}:${PORT}`);

  if (isLazyMcpBoot()) {
    void rebuildMcp(DEV_TENANT_ID)
      .then(() => app.log.info('MCP toolsets ready (background boot)'))
      .then(async () => {
        if (!compassIdentitySyncOn) {
          app.log.info(
            '[project-migration] skipped — compass-identity sync is off (no config or kill switch), default projects may not exist',
          );
          return;
        }
        await syncCompassIdentity(DEV_TENANT_ID);
        // AFTER the reconcile pass: default projects exist, legacy pins can map.
        await migrateProjectPins(DEV_TENANT_ID);
      })
      .catch((err) => app.log.warn({ err }, 'background MCP boot failed'));
  } else if (compassIdentitySyncOn) {
    await syncCompassIdentity(DEV_TENANT_ID);
    // AFTER the reconcile pass: default projects exist, legacy pins can map.
    await migrateProjectPins(DEV_TENANT_ID);
  } else {
    app.log.info(
      '[project-migration] skipped — compass-identity sync is off (no config or kill switch), default projects may not exist',
    );
  }

  // First tenant's MCP init has been issued (awaited above, or kicked off in
  // the background for lazy boot) — safe to start the self-heal loop now.
  if (isMcpAutoRetryEnabled()) {
    mcpAutoRetryLoop.start();
  } else {
    app.log.info('VEYLIN_MCP_AUTO_RETRY=0 — MCP auto-retry loop disabled');
  }

  if (compassIdentitySyncOn) {
    compassIdentitySyncLoop.start();
  } else if (compassIdentityConfig) {
    app.log.info('VEYLIN_COMPASS_IDENTITY_SYNC=0 — compass-identity periodic sync disabled');
  }

  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Shutting down (${signal})…`);
    try {
      mcpAutoRetryLoop.stop();
      compassIdentitySyncLoop.stop();
      await queue.stop();
      await waitForActiveChatDrain(Number(process.env.SHUTDOWN_DRAIN_MS ?? 30_000));
      if (mcp) {
        await mcp.disconnect().catch(() => undefined);
        mcp = null;
      }
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
