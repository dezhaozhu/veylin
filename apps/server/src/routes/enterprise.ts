import type { FastifyInstance } from 'fastify';
import { getEnterprisePorts } from '../ports/index.js';
import type { ServerDeps } from './types.js';

export function registerEnterpriseRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/enterprise/ports', async () => {
    const ports = getEnterprisePorts();
    return {
      identity: ports.identity.id,
      supportsLocalCredentials: ports.identity.supportsLocalCredentials,
      org: ports.org.id,
      businessSource: ports.businessSource.id,
      audit: ports.audit.id,
    };
  });

  app.get('/api/business-source', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const source = await getEnterprisePorts().businessSource.getSource(ctx.tenantId);
    return {
      source: source ?? {
        enabled: false,
        mcpServerName: 'business',
        hasCredential: false,
        toolAllowlist: [],
      },
    };
  });

  app.put('/api/business-source', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      enabled?: boolean;
      mcpServerName?: string;
      url?: string;
      transport?: 'http' | 'sse';
      authorization?: string;
      toolAllowlist?: string[];
      clearCredential?: boolean;
    };
    const source = await getEnterprisePorts().businessSource.updateSource(ctx.tenantId, body);
    // Rebuild MCP so new URL/headers take effect
    await deps.rebuildMcp(ctx.tenantId);
    return { source };
  });

  app.delete('/api/business-source', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const source = await getEnterprisePorts().businessSource.clearSource(ctx.tenantId);
    await deps.rebuildMcp(ctx.tenantId);
    return { source };
  });

  /** Rebuild MCP and report whether the configured business server is reachable. */
  app.post('/api/business-source/test', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const ports = getEnterprisePorts();
    const source = await ports.businessSource.getSource(ctx.tenantId);
    if (!source?.url && !source?.enabled) {
      return {
        ok: false,
        error: 'Business source is not configured. Save a MCP URL first.',
      };
    }
    await deps.rebuildMcp(ctx.tenantId);
    const health = deps.mcpHealthByTenant.get(ctx.tenantId);
    const name = source.mcpServerName || 'business';
    const server = health?.servers.find((s) => s.name === name);
    if (server?.connected) {
      return {
        ok: true,
        mcpServerName: name,
        toolCount: server.toolCount,
        tools: Object.keys(
          (deps.getMcpToolsets()[name] as Record<string, unknown> | undefined) ?? {},
        ).slice(0, 40),
      };
    }
    return {
      ok: false,
      mcpServerName: name,
      error:
        server?.lastError ||
        health?.lastError ||
        `MCP server "${name}" did not return tools. Check URL, credential, and network.`,
    };
  });

  app.get('/api/audit-logs', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const q = req.query as { limit?: string };
    const limit = q.limit ? Number(q.limit) : 50;
    const list = getEnterprisePorts().audit.list;
    const logs = list ? await list(ctx.tenantId, { limit }) : [];
    return { logs };
  });

  app.get('/api/audit-settings', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const { getAuditSettings } = await import('../ports/audit/local.js');
    return { settings: await getAuditSettings(ctx.tenantId) };
  });

  app.put('/api/audit-settings', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as { webhookUrl?: string };
    const { updateAuditSettings } = await import('../ports/audit/local.js');
    return { settings: await updateAuditSettings(ctx.tenantId, body) };
  });
}
