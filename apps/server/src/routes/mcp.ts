import type { FastifyInstance } from 'fastify';
import { mcpServerInputSchema } from '@veylin/shared';
import {
  createRemoteMcpServer,
  deleteRemoteMcpServer,
  listRemoteMcpServers,
  updateRemoteMcpServer,
} from '../mcp-store.js';
import { loadEnabledPluginMcpConfigs } from '../plugin-store.js';
import { getDisabledMcpServers, setDisabledMcpServers } from '../skills-store.js';
import type { ServerDeps } from './types.js';

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
    const ok = await deleteRemoteMcpServer(ctx.tenantId, id);
    if (!ok) {
      reply.code(404);
      return { ok: false };
    }
    await deps.rebuildMcp(ctx.tenantId);
    return { ok: true };
  });


}
