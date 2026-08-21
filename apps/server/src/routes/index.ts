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
import { registerCompassCredentialRoutes } from './compass-credential.js';
import { registerMcpOAuthRoutes } from './mcp-oauth.js';
import { registerAutomationsRoutes } from './automations.js';
import { registerWorkflowsRoutes } from './workflows.js';
import { registerWebhooksRoutes } from './webhooks.js';
import { registerTablesRoutes } from './tables.js';
import { registerAttachmentRoutes } from './attachments.js';
import { registerProjectsRoutes } from './projects.js';
import { registerThreadsRoutes } from './threads.js';
import { registerChatRoutes } from './chat.js';
import { registerGoalLoopRoutes } from './goal-loop.js';
import { registerRagRoutes } from './rag.js';
import { registerViewer3dRoutes } from './viewer3d.js';
import { registerMcpAppsRoutes } from './mcp-apps.js';
import { registerEnterpriseRoutes } from './enterprise.js';
import { registerDesktopAuthRoutes } from '../desktop-auth/routes.js';

export async function registerApiRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  registerHealthRoutes(app, deps);
  registerModelSettingsRoutes(app, deps);
  registerLangfuseSettingsRoutes(app, deps);
  registerEnterpriseRoutes(app, deps);
  registerDesktopAuthRoutes(app);
  registerSkillsRoutes(app, deps);
  registerHooksRoutes(app, deps);
  registerPluginsRoutes(app, deps);
  registerRulesRoutes(app, deps);
  registerMcpRoutes(app, deps);
  registerCompassCredentialRoutes(app, { syncCompassIdentity: deps.syncCompassIdentity });
  // 诊断要按租户查这台服务器配了什么头 —— 不给 resolveContext 的话,
  // compass 这种"凭据在登记里"的服务器又会被探成 401(即误报"需要授权")。
  registerMcpOAuthRoutes(app, { resolveContext: deps.resolveContext as never });
  registerAutomationsRoutes(app, deps);
  registerWorkflowsRoutes(app, deps);
  registerWebhooksRoutes(app, deps);
  registerTablesRoutes(app, deps);
  registerAttachmentRoutes(app, deps);
  registerProjectsRoutes(app, deps);
  registerThreadsRoutes(app, deps);
  registerGoalLoopRoutes(app, deps);
  registerChatRoutes(app, deps);
  registerRagRoutes(app, deps);
  registerViewer3dRoutes(app, deps);
  registerMcpAppsRoutes(app, deps);
}
