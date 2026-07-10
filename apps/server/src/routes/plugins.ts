import type { FastifyInstance } from 'fastify';
import {
  installFromMarketplace,
  installPluginFromGit,
  installPluginFromPath,
  listPluginInstalls,
  loadMarketplaceCatalog,
  setPluginEnabled,
  uninstallPlugin,
} from '../plugin-store.js';
import { reloadHooksForTenant } from '../hooks-service.js';
import type { ServerDeps } from './types.js';

export function registerPluginsRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/plugins', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const installed = await listPluginInstalls(ctx.tenantId);
    const marketplace = await loadMarketplaceCatalog();
    return { installed, marketplace };
  });

  app.post('/api/plugins/install', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      type?: 'path' | 'git' | 'marketplace';
      path?: string;
      url?: string;
      name?: string;
    };
    try {
      let installed;
      if (body.type === 'path' && body.path) {
        installed = await installPluginFromPath(ctx.tenantId, body.path);
      } else if (body.type === 'git' && body.url) {
        installed = await installPluginFromGit(ctx.tenantId, body.url);
      } else if (body.type === 'marketplace' && body.name) {
        const catalog = await loadMarketplaceCatalog();
        const entry = catalog.find((e) => e.name === body.name);
        if (!entry) {
          reply.code(404);
          return { ok: false, message: 'marketplace entry not found' };
        }
        installed = await installFromMarketplace(ctx.tenantId, entry);
      } else {
        reply.code(400);
        return { ok: false, message: 'type+path|url|name required' };
      }
      await reloadHooksForTenant(ctx.tenantId);
      const { getHookBus } = await import('../hooks-service.js');
      await getHookBus(ctx.tenantId).emit('ConfigChange', { source: 'plugins' });
      return { ok: true, plugin: installed };
    } catch (err) {
      reply.code(400);
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post('/api/plugins/:id/enable', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { enabled?: boolean };
    const row = await setPluginEnabled(ctx.tenantId, decodeURIComponent(id), body.enabled !== false);
    if (!row) {
      reply.code(404);
      return { ok: false };
    }
    await reloadHooksForTenant(ctx.tenantId);
    return { ok: true, plugin: row };
  });

  app.delete('/api/plugins/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const ok = await uninstallPlugin(ctx.tenantId, decodeURIComponent(id));
    if (!ok) {
      reply.code(404);
      return { ok: false };
    }
    await reloadHooksForTenant(ctx.tenantId);
    return { ok: true };
  });
}
