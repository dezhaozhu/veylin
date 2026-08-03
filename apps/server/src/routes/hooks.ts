import type { FastifyInstance } from 'fastify';
import { hookEventSchema, hookHandlerSchema } from '@veylin/hooks';
import { z } from 'zod';
import {
  createUserHook,
  deleteUserHook,
  getHookBus,
  hookIdentityKey,
  listHookLogs,
  reloadHooksForTenant,
  setHookDisabled,
  updateUserHook,
} from '../hooks-service.js';
import {
  getImportClaudeHooks,
  getWorkspaceRootSetting,
  loadVeylinSettings,
  setImportClaudeHooks,
  setWorkspaceRootSetting,
} from '../veylin-settings-file.js';
import type { ServerDeps } from './types.js';

const createHookBodySchema = z.object({
  event: hookEventSchema,
  matcher: z.string().optional(),
  handler: hookHandlerSchema,
});

const updateHookBodySchema = z.object({
  event: hookEventSchema.optional(),
  matcher: z.string().optional(),
  handler: hookHandlerSchema.optional(),
});

export function registerHooksRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/hooks', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const handlers = await reloadHooksForTenant(ctx.tenantId);
    return {
      hooks: handlers.map((h) => ({
        key: hookIdentityKey(h),
        event: h.event,
        matcher: h.matcher ?? '*',
        type: h.handler.type,
        source: h.source,
        sourceId: h.sourceId ?? null,
        enabled: h.enabled,
        dormant: h.dormant,
        configPath: h.configPath ?? null,
        handler: h.handler,
      })),
      logs: listHookLogs(ctx.tenantId, 50),
    };
  });

  app.post('/api/hooks/reload', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const handlers = await reloadHooksForTenant(ctx.tenantId);
    return { ok: true, count: handlers.length };
  });

  app.post('/api/hooks', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const parsed = createHookBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    try {
      const handlers = await createUserHook(ctx.tenantId, parsed.data);
      return { ok: true, count: handlers.length };
    } catch (err) {
      reply.code(400);
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.put('/api/hooks/:key', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { key } = req.params as { key: string };
    const parsed = updateHookBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    const ok = await updateUserHook(ctx.tenantId, decodeURIComponent(key), parsed.data);
    if (!ok) {
      reply.code(404);
      return { ok: false, message: 'user hook not found' };
    }
    return { ok: true };
  });

  app.delete('/api/hooks/:key', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { key } = req.params as { key: string };
    const ok = await deleteUserHook(ctx.tenantId, decodeURIComponent(key));
    if (!ok) {
      reply.code(404);
      return { ok: false, message: 'user hook not found' };
    }
    return { ok: true };
  });

  app.post('/api/hooks/disabled', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as { key?: string; disabled?: boolean };
    if (!body.key) {
      return { ok: false, message: 'key required' };
    }
    try {
      await setHookDisabled(ctx.tenantId, body.key, body.disabled !== false);
      await reloadHooksForTenant(ctx.tenantId);
      return { ok: true };
    } catch (err) {
      reply.code(500);
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.get('/api/workspace-settings', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const settings = await loadVeylinSettings(ctx.tenantId);
    const workspaceRoot = await getWorkspaceRootSetting(ctx.tenantId);
    return {
      workspaceRoot,
      workspaceRootSetting: settings.workspaceRoot,
      importClaudeHooks: await getImportClaudeHooks(ctx.tenantId),
    };
  });

  app.put('/api/workspace-settings', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      workspaceRoot?: string | null;
      importClaudeHooks?: boolean;
    };
    if (body.workspaceRoot !== undefined) {
      await setWorkspaceRootSetting(ctx.tenantId, body.workspaceRoot);
    }
    if (body.importClaudeHooks !== undefined) {
      await setImportClaudeHooks(ctx.tenantId, body.importClaudeHooks);
    }
    await reloadHooksForTenant(ctx.tenantId);
    getHookBus(ctx.tenantId);
    return {
      ok: true,
      ...(await getWorkspaceRootSetting(ctx.tenantId).then((workspaceRoot) => ({ workspaceRoot }))),
    };
  });
}
