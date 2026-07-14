import { apiUrl } from '@/lib/api-base';

const API = '';

export type SkillListItem = {
  name: string;
  description: string;
  source: 'bundled' | 'user' | 'plugin';
  type: string;
  triggers: string[];
  enabled: boolean;
  content?: string;
  id?: string;
  path?: string;
  pluginId?: string;
};

export type HookHandlerPayload = {
  type: string;
  command?: string;
  args?: string[];
  url?: string;
  prompt?: string;
  server?: string;
  tool?: string;
  subagent_type?: string;
};

export type HookListItem = {
  key: string;
  event: string;
  matcher: string;
  type: string;
  source: string;
  sourceId: string | null;
  enabled: boolean;
  dormant: boolean;
  configPath: string | null;
  handler?: HookHandlerPayload;
};

export type HookLogItem = {
  id: string;
  at: string;
  event: string;
  matcher?: string;
  source: string;
  decision?: string;
  durationMs?: number;
  error?: string;
  dormant?: boolean;
};

export type PluginInstall = {
  id: string;
  name: string;
  version?: string | null;
  description?: string | null;
  sourceType: string;
  source: string;
  installPath: string;
  enabled: boolean;
};

export type MarketplaceEntry = {
  name: string;
  description: string;
  version?: string;
  source: { type: 'path' | 'git'; url: string };
};

export type Rule = {
  id: string;
  name: string;
  content: string;
  trigger: 'always' | 'keyword';
  keywords: string[];
  enabled: boolean;
};

export type McpServer = {
  id: string;
  name: string;
  transport: 'sse' | 'http';
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
};

export type McpServerHealth = {
  name: string;
  connected: boolean;
  toolCount: number;
  lastError?: string;
};

export type McpHealthSnapshot = {
  lastError?: string;
  servers: McpServerHealth[];
};

export type Automation = {
  id: string;
  name: string;
  kind: 'cron' | 'event';
  agentId: string;
  prompt: string;
  enabled: boolean;
  cron?: string | null;
  timezone?: string | null;
  sourceType?: string;
  eventOn?: string | string[];
  eventFilter?: string;
  lastRunAt?: string | null;
};

export type AutomationRun = {
  id: string;
  threadId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  result?: string | null;
  startedAt: string;
  finishedAt?: string | null;
};

export type WebhookEndpoint = {
  id: string;
  name: string;
  source: string;
  url: string;
  eventKeyExpr: string;
  signatureHeader: string;
  enabled: boolean;
};

export type WebhookCreateBody =
  | { preset: 'github'; name?: string }
  | {
      name: string;
      source: string;
      eventKeyExpr?: string;
      signatureHeader?: string;
      webhookSecret?: string;
    };

import { normalizeModelProviderSettings } from '@/lib/model-provider-settings';

export type ModelProviderSettings = {
  modelName: string;
  requestUrl: string;
  hasApiKey: boolean;
  configured: boolean;
};

export type LangfuseSettings = {
  enabled: boolean;
  publicKey: string;
  baseUrl: string;
  hasSecretKey: boolean;
};

export type BusinessSourceSettings = {
  enabled: boolean;
  mcpServerName: string;
  hasCredential: boolean;
  toolAllowlist: string[];
  url?: string;
  transport?: 'http' | 'sse';
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null && init.body !== '';
  const headers = new Headers(init?.headers);
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(apiUrl(`${API}${path}`), {
    credentials: 'include',
    ...init,
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text || res.statusText;
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      if (typeof parsed?.message === 'string' && parsed.message.trim()) {
        message = parsed.message;
      }
    } catch {
      // not JSON
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const settingsApi = {
  getModelSettings: async () => {
    const res = await apiFetch<{ settings: ModelProviderSettings }>('/api/model-settings');
    return { settings: normalizeModelProviderSettings(res.settings) };
  },
  updateModelSettings: async (body: { modelName?: string; requestUrl?: string; apiKey?: string }) => {
    const res = await apiFetch<{ settings: ModelProviderSettings }>('/api/model-settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return { settings: normalizeModelProviderSettings(res.settings) };
  },
  clearModelSettings: async () => {
    try {
      const res = await apiFetch<{ settings: ModelProviderSettings }>('/api/model-settings', {
        method: 'DELETE',
      });
      return { settings: normalizeModelProviderSettings(res.settings) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('404') && !message.includes('Not Found')) {
        throw err;
      }
      return settingsApi.updateModelSettings({
        modelName: '',
        requestUrl: '',
        apiKey: '',
      });
    }
  },

  getLangfuseSettings: async () => {
    const res = await apiFetch<{ settings: LangfuseSettings }>('/api/langfuse-settings');
    return { settings: res.settings };
  },
  updateLangfuseSettings: async (body: {
    enabled?: boolean;
    publicKey?: string;
    secretKey?: string;
    baseUrl?: string;
  }) => {
    const res = await apiFetch<{ settings: LangfuseSettings }>('/api/langfuse-settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return { settings: res.settings };
  },
  clearLangfuseSettings: async () => {
    const res = await apiFetch<{ settings: LangfuseSettings }>('/api/langfuse-settings', {
      method: 'DELETE',
    });
    return { settings: res.settings };
  },

  getBusinessSource: async () => {
    const res = await apiFetch<{ source: BusinessSourceSettings }>('/api/business-source');
    return { source: res.source };
  },
  updateBusinessSource: async (body: {
    enabled?: boolean;
    mcpServerName?: string;
    url?: string;
    transport?: 'http' | 'sse';
    authorization?: string;
    toolAllowlist?: string[];
    clearCredential?: boolean;
  }) => {
    const res = await apiFetch<{ source: BusinessSourceSettings }>('/api/business-source', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return { source: res.source };
  },
  testBusinessSource: async () => {
    return apiFetch<{
      ok: boolean;
      error?: string;
      mcpServerName?: string;
      toolCount?: number;
      tools?: string[];
    }>('/api/business-source/test', { method: 'POST', body: '{}' });
  },
  getAuditSettings: async () => {
    const res = await apiFetch<{ settings: { webhookUrl: string } }>('/api/audit-settings');
    return res;
  },
  updateAuditSettings: async (body: { webhookUrl?: string }) => {
    const res = await apiFetch<{ settings: { webhookUrl: string } }>('/api/audit-settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return res;
  },
  getAuditLogs: async (limit = 50) => {
    const res = await apiFetch<{
      logs: Array<{
        id?: string;
        action?: string;
        userId?: string | null;
        createdAt?: string;
        detail?: unknown;
      }>;
    }>(`/api/audit-logs?limit=${limit}`);
    return res;
  },

  getSkills: () =>
    apiFetch<{ skills: SkillListItem[]; disabledSkills: string[]; skillsDir?: string }>('/api/skills'),
  saveDisabledSkills: (disabledSkills: string[]) =>
    apiFetch('/api/skills/disabled', {
      method: 'POST',
      body: JSON.stringify({ disabledSkills }),
    }),
  createSkill: (body: { name: string; description?: string; content: string; enabled?: boolean }) =>
    apiFetch<{ ok: boolean; skill: SkillListItem }>('/api/skills', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSkill: (
    id: string,
    body: Partial<{ name: string; description: string; content: string; enabled: boolean }>,
  ) =>
    apiFetch<{ ok: boolean; skill: SkillListItem }>(`/api/skills/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteSkill: (id: string) =>
    apiFetch(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  importSkill: (path: string) =>
    apiFetch<{ ok: boolean; skill: SkillListItem }>('/api/skills/import', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  getHooks: () => apiFetch<{ hooks: HookListItem[]; logs: HookLogItem[] }>('/api/hooks'),
  reloadHooks: () => apiFetch<{ ok: boolean; count: number }>('/api/hooks/reload', { method: 'POST' }),
  createHook: (body: { event: string; matcher?: string; handler: HookHandlerPayload }) =>
    apiFetch<{ ok: boolean; count: number }>('/api/hooks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateHook: (
    key: string,
    body: { event?: string; matcher?: string; handler?: HookHandlerPayload },
  ) =>
    apiFetch<{ ok: boolean }>(`/api/hooks/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteHook: (key: string) =>
    apiFetch(`/api/hooks/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  setHookDisabled: (key: string, disabled: boolean) =>
    apiFetch('/api/hooks/disabled', {
      method: 'POST',
      body: JSON.stringify({ key, disabled }),
    }),
  getWorkspaceSettings: () =>
    apiFetch<{
      workspaceRoot: string | null;
      workspaceRootSetting: string | null;
      importClaudeHooks: boolean;
    }>('/api/workspace-settings'),
  saveWorkspaceSettings: (body: {
    workspaceRoot?: string | null;
    importClaudeHooks?: boolean;
  }) =>
    apiFetch('/api/workspace-settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  getPlugins: () =>
    apiFetch<{ installed: PluginInstall[]; marketplace: MarketplaceEntry[] }>('/api/plugins'),
  installPlugin: (body: {
    type: 'path' | 'git' | 'marketplace';
    path?: string;
    url?: string;
    name?: string;
  }) =>
    apiFetch<{ ok: boolean; plugin?: PluginInstall; message?: string }>('/api/plugins/install', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setPluginEnabled: (id: string, enabled: boolean) =>
    apiFetch<{ ok: boolean; plugin?: PluginInstall }>(
      `/api/plugins/${encodeURIComponent(id)}/enable`,
      { method: 'POST', body: JSON.stringify({ enabled }) },
    ),
  uninstallPlugin: (id: string) =>
    apiFetch(`/api/plugins/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getRules: () => apiFetch<{ rules: Rule[] }>('/api/rules'),
  createRule: (body: {
    name: string;
    content: string;
    trigger?: 'always' | 'keyword';
    keywords?: string[];
    enabled?: boolean;
  }) => apiFetch<{ ok: boolean; rule: Rule }>('/api/rules', { method: 'POST', body: JSON.stringify(body) }),
  updateRule: (id: string, body: Partial<Rule>) =>
    apiFetch<{ ok: boolean; rule: Rule }>(`/api/rules/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteRule: (id: string) => apiFetch(`/api/rules/${id}`, { method: 'DELETE' }),

  getMcpServers: () =>
    apiFetch<{
      bundled: string[];
      remote: McpServer[];
      plugin?: Array<{
        name: string;
        pluginId: string;
        transport: 'stdio';
        command: string;
        args: string[];
        cwd?: string;
      }>;
      disabledMcp: string[];
      health: McpHealthSnapshot | null;
    }>('/api/mcp-servers'),
  reconnectMcpServers: () =>
    apiFetch<{ ok: boolean; health: McpHealthSnapshot | null }>('/api/mcp-servers/reconnect', {
      method: 'POST',
    }),
  saveDisabledMcp: (disabledMcp: string[]) =>
    apiFetch<{ ok: boolean; disabledMcp: string[]; health?: McpHealthSnapshot | null }>(
      '/api/mcp-servers/disabled',
      {
        method: 'POST',
        body: JSON.stringify({ disabledMcp }),
      },
    ),
  createMcpServer: (body: {
    name: string;
    transport: 'sse' | 'http';
    url: string;
    headers?: Record<string, string>;
    enabled?: boolean;
  }) => apiFetch('/api/mcp-servers', { method: 'POST', body: JSON.stringify(body) }),
  updateMcpServer: (id: string, body: Partial<McpServer>) =>
    apiFetch(`/api/mcp-servers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteMcpServer: (id: string) => apiFetch(`/api/mcp-servers/${id}`, { method: 'DELETE' }),

  getAutomations: () => apiFetch<{ automations: Automation[] }>('/api/automations'),
  getAutomationRuns: (id: string) =>
    apiFetch<{ runs: AutomationRun[] }>(`/api/automations/${id}/runs`),
  createAutomation: (body: {
    name: string;
    kind: 'cron' | 'event';
    agentId?: string;
    prompt: string;
    cron?: string;
    timezone?: string;
    sourceType?: string;
    eventOn?: string | string[];
    eventFilter?: string;
    enabled?: boolean;
  }) => apiFetch('/api/automations', { method: 'POST', body: JSON.stringify(body) }),
  updateAutomation: (id: string, body: Record<string, unknown>) =>
    apiFetch(`/api/automations/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteAutomation: (id: string) => apiFetch(`/api/automations/${id}`, { method: 'DELETE' }),
  triggerAutomation: (id: string) =>
    apiFetch(`/api/automations/${id}/trigger`, { method: 'POST' }),

  getWebhooks: () => apiFetch<{ endpoints: WebhookEndpoint[] }>('/api/webhooks'),
  createWebhook: (body: WebhookCreateBody) =>
    apiFetch<{ endpoint: WebhookEndpoint; secret: string | null }>('/api/webhooks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteWebhook: (id: string) => apiFetch(`/api/webhooks/${id}`, { method: 'DELETE' }),
  updateWebhook: (
    id: string,
    body: {
      name?: string;
      eventKeyExpr?: string;
      signatureHeader?: string;
      enabled?: boolean;
    },
  ) =>
    apiFetch<{ endpoint: WebhookEndpoint }>(`/api/webhooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};
