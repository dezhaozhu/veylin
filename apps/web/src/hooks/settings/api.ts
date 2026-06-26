import { apiUrl } from '@/lib/api-base';

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
    throw new Error(text || res.statusText);
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

  getSkills: () =>
    apiFetch<{ skills: SkillListItem[]; disabledSkills: string[] }>('/api/skills'),
  saveDisabledSkills: (disabledSkills: string[]) =>
    apiFetch('/api/skills/disabled', {
      method: 'POST',
      body: JSON.stringify({ disabledSkills }),
    }),
  createSkill: (body: { name: string; description?: string; content: string; enabled?: boolean }) =>
    apiFetch<{ ok: boolean; skill: SkillListItem }>('/api/skills', { method: 'POST', body: JSON.stringify(body) }),
  updateSkill: (id: string, body: Partial<{ name: string; description: string; content: string; enabled: boolean }>) =>
    apiFetch<{ ok: boolean; skill: SkillListItem }>(`/api/skills/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSkill: (id: string) => apiFetch(`/api/skills/${id}`, { method: 'DELETE' }),

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
