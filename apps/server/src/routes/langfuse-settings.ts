import type { FastifyInstance } from 'fastify';
import { langfuseSettingsPatchSchema } from '@veylin/shared';
import {
  clearLangfuseSettings,
  getLangfuseSettings,
  updateLangfuseSettings,
} from '../langfuse-settings-store.js';
import type { ServerDeps } from './types.js';

export function registerLangfuseSettingsRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/langfuse-settings', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    return { settings: await getLangfuseSettings(ctx.tenantId) };
  });

  app.put('/api/langfuse-settings', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = langfuseSettingsPatchSchema.parse(req.body ?? {});
    return { settings: await updateLangfuseSettings(ctx.tenantId, body) };
  });

  app.delete('/api/langfuse-settings', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    return { settings: await clearLangfuseSettings(ctx.tenantId) };
  });
}
