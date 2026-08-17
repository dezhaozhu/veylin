import type { FastifyInstance } from 'fastify';
import { resolveCompassIdentity } from '../compass-credential.js';
import { mcpServerInputSchema } from '@veylin/shared';
import {
  COMPASS_IDENTITY_GROUP,
  fetchCompassSources,
} from '../compass-identity.js';
import {
  createRemoteMcpServer,
  deleteRemoteMcpServer,
  listRemoteMcpServers,
  updateRemoteMcpServer,
} from '../mcp-store.js';
import { loadEnabledPluginMcpConfigs } from '../plugin-store.js';
import { getDisabledMcpServers, setDisabledMcpServers } from '../skills-store.js';
import type { ServerDeps } from './types.js';

/**
 * Managed (reconciler-owned) MCP rows are structurally immutable through this
 * API — same treatment the project table gives `migratedFrom` (security
 * review F1). Allowing a user PUT to change a managed compass row's `group`
 * would move it out of COMPASS_IDENTITY_GROUP, so `buildMcpServerConfigs`
 * would stop excluding it and the next rebuild would open a HEADERLESS
 * (scene-less) compass connection on the generic tenant/agent-run clients —
 * exactly the session shape the pool exists to prevent. The settings UI
 * already renders managed rows read-only; this makes the server agree.
 */
async function findManagedRow(tenantId: string, id: string) {
  const rows = await listRemoteMcpServers(tenantId);
  const row = rows.find((r) => r.id === id);
  return row?.managed ? row : null;
}

/**
 * Companion guard (review F1-gap): the API must not be able to CREATE what
 * the immutability guard protects, either. `managed: true` via POST/PUT
 * would mint a self-locked row (403 forever, no API recovery); a second row
 * in COMPASS_IDENTITY_GROUP would trip the prelude's exactly-one anomaly
 * refusal and silently cut every project-pinned thread off compass
 * tenant-wide. Both fields are system-maintained: `managed` only by the
 * reconciler (store-level), the compass group only by reconcile output.
 * Returns an error string, or null when the body is acceptable.
 */
function rejectSystemFields(data: { managed?: boolean; group?: string | null }): string | null {
  if (data.managed !== undefined) return 'managed 由系统维护,不可通过 API 设置';
  if (data.group === COMPASS_IDENTITY_GROUP) {
    return `分组 ${COMPASS_IDENTITY_GROUP} 由 Compass 身份保留,不可手工加入`;
  }
  return null;
}

export function registerMcpRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // --- Customize: MCP ---
  app.get('/api/mcp-servers', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const remote = await listRemoteMcpServers(ctx.tenantId);
    const disabledMcp = await getDisabledMcpServers(ctx.tenantId);
    const health = deps.mcpHealthByTenant.get(ctx.tenantId);
    const pluginConfigs = await loadEnabledPluginMcpConfigs(ctx.tenantId);
    const plugin = Object.entries(pluginConfigs).map(([name, config]) => {
      const pluginId = name.includes('/') ? name.slice(0, name.indexOf('/')) : name;
      return {
        name,
        pluginId,
        transport: 'stdio' as const,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
      };
    });
    return { bundled: [] as string[], remote, plugin, disabledMcp, health: health ?? null };
  });

  app.post('/api/mcp-servers/reconnect', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    await deps.rebuildMcp(ctx.tenantId);
    return { ok: true, health: deps.mcpHealthByTenant.get(ctx.tenantId) ?? null };
  });

  app.post('/api/mcp-servers/disabled', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const { disabledMcp } = (req.body ?? {}) as { disabledMcp?: string[] };
    await setDisabledMcpServers(ctx.tenantId, disabledMcp ?? []);
    await deps.rebuildMcp(ctx.tenantId);
    return {
      ok: true,
      disabledMcp: disabledMcp ?? [],
      health: deps.mcpHealthByTenant.get(ctx.tenantId) ?? null,
    };
  });

  app.post('/api/mcp-servers', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const parsed = mcpServerInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const rejected = rejectSystemFields(parsed.data);
    if (rejected) {
      reply.code(400);
      return { ok: false, message: rejected };
    }
    const server = await createRemoteMcpServer(ctx.tenantId, parsed.data);
    await deps.rebuildMcp(ctx.tenantId);
    return { ok: true, server };
  });

  app.put('/api/mcp-servers/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const parsed = mcpServerInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const rejected = rejectSystemFields(parsed.data);
    if (rejected) {
      reply.code(400);
      return { ok: false, message: rejected };
    }
    if (await findManagedRow(ctx.tenantId, id)) {
      reply.code(403);
      return { ok: false, message: '该条目由 Compass 身份自动管理,不可编辑' };
    }
    const server = await updateRemoteMcpServer(ctx.tenantId, id, parsed.data);
    if (!server) {
      reply.code(404);
      return { ok: false };
    }
    await deps.rebuildMcp(ctx.tenantId);
    return { ok: true, server };
  });

  app.delete('/api/mcp-servers/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    if (await findManagedRow(ctx.tenantId, id)) {
      reply.code(403);
      return { ok: false, message: '该条目由 Compass 身份自动管理,不可删除' };
    }
    const ok = await deleteRemoteMcpServer(ctx.tenantId, id);
    if (!ok) {
      reply.code(404);
      return { ok: false };
    }
    await deps.rebuildMcp(ctx.tenantId);
    return { ok: true };
  });

  // Manual trigger for the compass-identity reconciler (see compass-identity.ts) —
  // same summary shape as the boot run and the self-scheduling 10-minute tick.
  // No-op (not 404) when VEYLIN_COMPASS_IDENTITY isn't configured, mirroring how
  // the rest of this feature stays silent when off.
  /**
   * 当前是以**谁**的身份连着 Compass。
   *
   * 一个 install 一份 token —— 同事之间复制了同一份,Compass 眼里就是同一个人。
   * 不把身份摆到脸上,"权限按人分"就只是架构图上的话,没人会发现它没成立。
   */
  app.get('/api/compass-identity/whoami', async () => {
    // 用时解析(凭据文件优先, .env 兜底) —— 刚在界面上连好的凭据,
    // 这里必须马上认,不能等重启。
    const config = resolveCompassIdentity();
    if (!config) return { ok: true, configured: false };
    const out = await fetchCompassSources(config);
    if (!out.ok) return { ok: false, configured: true, error: out.error };
    return {
      ok: true,
      configured: true,
      url: config.url,
      // 老版本 Compass 不返 username —— 标成未知,不猜
      username: out.username ?? null,
      sources: out.sources,
    };
  });

  app.post('/api/compass-identity/refresh', async () => {
    if (!deps.syncCompassIdentity) {
      return { ok: true, enabled: false, summary: null };
    }
    const summary = await deps.syncCompassIdentity();
    return { ok: true, enabled: true, summary };
  });
}
