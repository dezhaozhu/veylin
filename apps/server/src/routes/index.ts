import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from './types.js';
import { registerHealthRoutes } from './health.js';
import { registerModelSettingsRoutes } from './model-settings.js';
import { registerLangfuseSettingsRoutes } from './langfuse-settings.js';
import { registerSkillsRoutes } from './skills.js';
import { registerHooksRoutes } from './hooks.js';
import { registerPluginsRoutes } from './plugins.js';
import { registerRulesRoutes } from './rules.js';
import { registerMcpRoutes } from './mcp.js';
import { registerAutomationsRoutes } from './automations.js';
import { registerWorkflowsRoutes } from './workflows.js';
import { registerWebhooksRoutes } from './webhooks.js';
import { registerTablesRoutes } from './tables.js';
import { registerThreadsRoutes } from './threads.js';
import { registerChatRoutes } from './chat.js';
import { registerGoalLoopRoutes } from './goal-loop.js';
import { registerRagRoutes } from './rag.js';

export async function registerApiRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  registerHealthRoutes(app, deps);
  registerModelSettingsRoutes(app, deps);
  registerLangfuseSettingsRoutes(app, deps);
  registerSkillsRoutes(app, deps);
  registerHooksRoutes(app, deps);
  registerPluginsRoutes(app, deps);
  registerRulesRoutes(app, deps);
  registerMcpRoutes(app, deps);
  registerAutomationsRoutes(app, deps);
  registerWorkflowsRoutes(app, deps);
  registerWebhooksRoutes(app, deps);
  registerTablesRoutes(app, deps);
  registerThreadsRoutes(app, deps);
  registerGoalLoopRoutes(app, deps);
  registerChatRoutes(app, deps);
  registerRagRoutes(app, deps);
}
