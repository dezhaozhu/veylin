import type { FastifyInstance } from 'fastify';
import {
  getDefaultCatalogModel,
  listModelCatalogPublicWithContextWindows,
  loadModelCatalog,
} from '@veylin/runtime';
import { modelProviderSettingsPatchSchema } from '@veylin/shared';
import {
  clearModelSettings,
  getModelSettings,
  updateModelSettings,
} from '../model-settings-store.js';
import { refreshAgentPackages } from '../agent-packages-sync.js';
import { listMergedSkills } from '../skills-store.js';
import { listActiveMcpServerNames } from '../mcp-store.js';
import type { ServerDeps } from './types.js';

export function registerModelSettingsRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/model-settings', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
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
    const models = await listModelCatalogPublicWithContextWindows();
    const primary = getDefaultCatalogModel();
    return {
      models,
      defaultId: primary?.id ?? models[0]?.id ?? null,
    };
  });

  app.put('/api/model-settings', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = modelProviderSettingsPatchSchema.parse(req.body ?? {});
    return { settings: await updateModelSettings(ctx.tenantId, body) };
  });

  app.delete('/api/model-settings', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    return { settings: await clearModelSettings(ctx.tenantId) };
  });

  app.get('/api/agent-context', async (req) => {
    const { agentId } = req.query as { agentId?: string };
    const ctx = await deps.resolveContext(req.headers);
    await refreshAgentPackages(deps.runtime, { force: true });
    const base = deps.runtime.getAgentContext(agentId);
    const resolvedAgentId = agentId ?? base.agentId;
    const mergedSkills = await listMergedSkills(deps.runtime, ctx.tenantId, resolvedAgentId);
    const declaredMcp = deps.runtime.definitions.get(resolvedAgentId)?.definition.mcpServers ?? base.mcpServers;
    const mcpServers = await listActiveMcpServerNames(ctx.tenantId, declaredMcp);
    return {
      ...base,
      agentId: resolvedAgentId,
      skills: mergedSkills
        .filter((s) => s.enabled && s.userInvocable !== false)
        .map((s) => ({ name: s.name, description: s.description })),
      mcpServers,
    };
  });


}
