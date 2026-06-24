const API = '';

export type SkillListItem = {
  name: string;
  description: string;
  source: 'bundled' | 'custom';
  type: string;
  triggers: string[];
  enabled: boolean;
  content?: string;
  id?: string;
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

export type Automation = {
  id: string;
  name: string;
  kind: 'schedule' | 'event';
  agentId: string;
  prompt: string;
  enabled: boolean;
  cron?: string | null;
  timezone?: string | null;
  sourceType?: string;
  triggerFilter?: Record<string, unknown>;
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
  token: string;
  sourceType: 'github' | 'custom';
  url: string;
};

export type ModelProviderSettings = {
  openaiApiKeyEnabled: boolean;
  hasOpenaiApiKey: boolean;
  overrideOpenAIBaseUrl: boolean;
  openaiBaseUrl: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const settingsApi = {
  getModelSettings: () =>
    apiFetch<{ settings: ModelProviderSettings }>('/api/model-settings'),
  updateModelSettings: (body: Partial<ModelProviderSettings> & { openaiApiKey?: string }) =>
    apiFetch<{ settings: ModelProviderSettings }>('/api/model-settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  getSkills: () =>
    apiFetch<{ skills: SkillListItem[]; disabledSkills: string[] }>('/api/skills'),
  saveDisabledSkills: (disabledSkills: string[]) =>
    apiFetch('/api/skills/disabled', {
      method: 'POST',
      body: JSON.stringify({ disabledSkills }),
    }),
  createSkill: (body: { name: string; description?: string; content: string; enabled?: boolean }) =>
    apiFetch('/api/skills', { method: 'POST', body: JSON.stringify(body) }),
  updateSkill: (id: string, body: Partial<{ name: string; description: string; content: string; enabled: boolean }>) =>
    apiFetch(`/api/skills/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSkill: (id: string) => apiFetch(`/api/skills/${id}`, { method: 'DELETE' }),

  getRules: () => apiFetch<{ rules: Rule[] }>('/api/rules'),
  createRule: (body: {
    name: string;
    content: string;
    trigger?: 'always' | 'keyword';
    keywords?: string[];
    enabled?: boolean;
  }) => apiFetch('/api/rules', { method: 'POST', body: JSON.stringify(body) }),
  updateRule: (id: string, body: Partial<Rule>) =>
    apiFetch(`/api/rules/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteRule: (id: string) => apiFetch(`/api/rules/${id}`, { method: 'DELETE' }),

  getMcpServers: () =>
    apiFetch<{ bundled: string[]; remote: McpServer[]; disabledMcp: string[] }>(
      '/api/mcp-servers',
    ),
  saveDisabledMcp: (disabledMcp: string[]) =>
    apiFetch('/api/mcp-servers/disabled', {
      method: 'POST',
      body: JSON.stringify({ disabledMcp }),
    }),
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
    kind: 'schedule' | 'event';
    agentId?: string;
    prompt: string;
    cron?: string;
    timezone?: string;
    sourceType?: string;
    triggerFilter?: Record<string, unknown>;
    enabled?: boolean;
  }) => apiFetch('/api/automations', { method: 'POST', body: JSON.stringify(body) }),
  updateAutomation: (id: string, body: Record<string, unknown>) =>
    apiFetch(`/api/automations/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteAutomation: (id: string) => apiFetch(`/api/automations/${id}`, { method: 'DELETE' }),
  triggerAutomation: (id: string) =>
    apiFetch(`/api/automations/${id}/trigger`, { method: 'POST' }),

  getWebhooks: () => apiFetch<{ endpoints: WebhookEndpoint[] }>('/api/webhooks'),
  createWebhook: (sourceType: 'github' | 'custom') =>
    apiFetch<{ endpoint: WebhookEndpoint; secret: string }>('/api/webhooks', {
      method: 'POST',
      body: JSON.stringify({ sourceType }),
    }),
  deleteWebhook: (id: string) => apiFetch(`/api/webhooks/${id}`, { method: 'DELETE' }),
};
