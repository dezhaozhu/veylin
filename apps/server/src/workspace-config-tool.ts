import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Runtime } from '@veylin/runtime';
import { DEFAULT_AGENT_ID } from '@veylin/shared';
import type { QueuePort } from './queue';
import {
  createUserSkill,
  deleteUserSkill,
  getDisabledMcpServers,
  getDisabledSkills,
  listMergedSkills,
  setDisabledMcpServers,
  setDisabledSkills,
  updateUserSkill,
} from './skills-store';
import {
  createRemoteMcpServer,
  deleteRemoteMcpServer,
  listRemoteMcpServers,
  updateRemoteMcpServer,
} from './mcp-store';
import {
  createGithubWebhookEndpoint,
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  listWebhookEndpoints,
} from './webhook-store';
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  updateAutomation,
} from './automation-store';
import { dispatchAutomation } from './automation-worker';
import {
  registerAutomationSchedule,
  unregisterAutomationSchedule,
} from './queue';

const resourceSchema = z.enum(['skill', 'mcp_server', 'webhook', 'automation']);
const actionSchema = z.enum([
  'list',
  'create',
  'update',
  'delete',
  'set_enabled',
  'trigger',
]);

type ConfigInput = {
  resource: z.infer<typeof resourceSchema>;
  action: z.infer<typeof actionSchema>;
  id?: string;
  agentId?: string;
  name?: string;
  description?: string;
  content?: string;
  enabled?: boolean;
  transport?: 'sse' | 'http';
  url?: string;
  headers?: Record<string, string>;
  source?: string;
  preset?: 'github';
  eventKeyExpr?: string;
  signatureHeader?: string;
  kind?: 'cron' | 'event';
  prompt?: string;
  cron?: string;
  timezone?: string;
  sourceType?: 'cron' | string;
  eventOn?: string | string[];
  eventFilter?: string;
};

interface ConfigCtx {
  requestContext?: { get(key: string): unknown };
}

function ctxValue(ctx: ConfigCtx | undefined, key: string): string | undefined {
  return ctx?.requestContext?.get(key) as string | undefined;
}

export interface BuildWorkspaceConfigToolOptions {
  runtime: Runtime;
  queue: QueuePort;
  onMcpRebuild: (tenantId: string) => Promise<void>;
  defaultBaseUrl?: string;
}

/**
 * Single workspace configuration tool (Claude Code ConfigTool-style).
 * Replaces 19 granular skill/mcp/webhook/automation CRUD tools.
 */
export function buildWorkspaceConfigTool(opts: BuildWorkspaceConfigToolOptions) {
  const { runtime, queue, onMcpRebuild, defaultBaseUrl = 'http://127.0.0.1:8787' } = opts;

  return createTool({
    id: 'workspace_config',
    description:
      'Get or change workspace settings: skills, MCP servers, webhooks, and automations. ' +
      'Use action=list to enumerate; create/update/delete/set_enabled/trigger for mutations. ' +
      'Users can also manage these in Settings; use this when they ask in chat.',
    inputSchema: z.object({
      resource: resourceSchema,
      action: actionSchema,
      id: z.string().optional().describe('Resource id (required for update/delete/trigger).'),
      agentId: z.string().optional().describe(`Agent scope for skill list (default ${DEFAULT_AGENT_ID}).`),
      name: z.string().optional(),
      description: z.string().optional(),
      content: z.string().optional().describe('Skill body (SKILL.md-style).'),
      enabled: z.boolean().optional(),
      transport: z.enum(['sse', 'http']).optional(),
      url: z.string().url().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      source: z.string().optional().describe('Webhook source slug.'),
      preset: z.enum(['github']).optional(),
      eventKeyExpr: z.string().optional(),
      signatureHeader: z.string().optional(),
      kind: z.enum(['cron', 'event']).optional(),
      prompt: z.string().optional(),
      cron: z.string().optional(),
      timezone: z.string().optional(),
      sourceType: z.union([z.literal('cron'), z.string().min(1)]).optional(),
      eventOn: z.union([z.string(), z.array(z.string())]).optional(),
      eventFilter: z.string().optional(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      data: z.unknown().optional(),
      error: z.string().optional(),
    }),
    execute: async (input: ConfigInput, ctx?: ConfigCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const userId = ctxValue(ctx, 'userId') ?? 'dev-user';
      const baseUrl = ctxValue(ctx, 'publicBaseUrl') ?? defaultBaseUrl;

      try {
        switch (input.resource) {
          case 'skill':
            return { ok: true, data: await runSkillAction(input, { tenantId, runtime }) };
          case 'mcp_server':
            return {
              ok: true,
              data: await runMcpAction(input, { tenantId, onMcpRebuild }),
            };
          case 'webhook':
            return { ok: true, data: await runWebhookAction(input, { tenantId, baseUrl }) };
          case 'automation':
            return {
              ok: true,
              data: await runAutomationAction(input, { tenantId, userId, queue }),
            };
          default:
            return { ok: false, error: 'Unknown resource' };
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}

async function runSkillAction(
  input: ConfigInput,
  opts: { tenantId: string; runtime: Runtime },
) {
  const agentId = input.agentId ?? DEFAULT_AGENT_ID;

  if (input.action === 'list') {
    const rows = await listMergedSkills(opts.runtime, opts.tenantId, agentId);
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      source: s.source,
      enabled: s.enabled,
    }));
  }

  if (input.action === 'set_enabled') {
    if (!input.name || input.enabled === undefined) {
      throw new Error('set_enabled requires name and enabled');
    }
    const rows = await listMergedSkills(opts.runtime, opts.tenantId, agentId);
    const hit = rows.find((s) => s.name === input.name);
    if (!hit) return { ok: false };

    if (hit.source === 'bundled') {
      const disabled = new Set(await getDisabledSkills(opts.tenantId));
      if (input.enabled) disabled.delete(input.name);
      else disabled.add(input.name);
      await setDisabledSkills(opts.tenantId, [...disabled]);
      return { ok: true };
    }
    if (!hit.id) return { ok: false };
    const row = await updateUserSkill(hit.id, { enabled: input.enabled });
    return { ok: row != null };
  }

  if (input.action === 'create') {
    if (!input.name || !input.content) throw new Error('create requires name and content');
    const row = await createUserSkill({
      name: input.name,
      description: input.description ?? '',
      content: input.content,
      enabled: input.enabled ?? true,
    });
    return { id: row.id, name: row.name };
  }

  if (input.action === 'update') {
    if (!input.id) throw new Error('update requires id');
    const row = await updateUserSkill(input.id, {
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.description != null ? { description: input.description } : {}),
      ...(input.content != null ? { content: input.content } : {}),
      ...(input.enabled != null ? { enabled: input.enabled } : {}),
    });
    return { ok: row != null };
  }

  if (input.action === 'delete') {
    if (!input.id) throw new Error('delete requires id');
    const ok = await deleteUserSkill(input.id);
    return { ok };
  }

  throw new Error(`Unsupported skill action: ${input.action}`);
}

async function runMcpAction(
  input: ConfigInput,
  opts: { tenantId: string; onMcpRebuild: (tenantId: string) => Promise<void> },
) {
  if (input.action === 'list') {
    const servers = await listRemoteMcpServers(opts.tenantId);
    return servers.map((s) => ({
      id: s.id,
      name: s.name,
      transport: s.transport,
      url: s.url,
      enabled: s.enabled,
    }));
  }

  if (input.action === 'create') {
    if (!input.name || !input.transport || !input.url) {
      throw new Error('create requires name, transport, and url');
    }
    const server = await createRemoteMcpServer(opts.tenantId, {
      name: input.name,
      transport: input.transport,
      url: input.url,
      headers: input.headers ?? {},
      enabled: input.enabled ?? true,
    });
    await opts.onMcpRebuild(opts.tenantId);
    return { id: server.id, name: server.name };
  }

  if (input.action === 'update') {
    if (!input.id) throw new Error('update requires id');
    const server = await updateRemoteMcpServer(opts.tenantId, input.id, {
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.transport != null ? { transport: input.transport } : {}),
      ...(input.url != null ? { url: input.url } : {}),
      ...(input.headers != null ? { headers: input.headers } : {}),
      ...(input.enabled != null ? { enabled: input.enabled } : {}),
    });
    if (server) await opts.onMcpRebuild(opts.tenantId);
    return { ok: server != null };
  }

  if (input.action === 'delete') {
    if (!input.id) throw new Error('delete requires id');
    const ok = await deleteRemoteMcpServer(opts.tenantId, input.id);
    if (ok) await opts.onMcpRebuild(opts.tenantId);
    return { ok };
  }

  if (input.action === 'set_enabled') {
    if (!input.name || input.enabled === undefined) {
      throw new Error('set_enabled requires name and enabled');
    }
    const remote = await listRemoteMcpServers(opts.tenantId);
    const hit = remote.find((s) => s.name === input.name);
    if (hit) {
      const server = await updateRemoteMcpServer(opts.tenantId, hit.id, {
        enabled: input.enabled,
      });
      if (server) await opts.onMcpRebuild(opts.tenantId);
      return { ok: server != null };
    }
    const disabled = new Set(await getDisabledMcpServers(opts.tenantId));
    if (input.enabled) disabled.delete(input.name);
    else disabled.add(input.name);
    await setDisabledMcpServers(opts.tenantId, [...disabled]);
    await opts.onMcpRebuild(opts.tenantId);
    return { ok: true };
  }

  throw new Error(`Unsupported mcp_server action: ${input.action}`);
}

async function runWebhookAction(
  input: ConfigInput,
  opts: { tenantId: string; baseUrl: string },
) {
  if (input.action === 'list') {
    const endpoints = await listWebhookEndpoints(opts.tenantId, opts.baseUrl);
    return endpoints.map((e) => ({
      id: e.id,
      name: e.name,
      source: e.source,
      url: e.url,
      enabled: e.enabled,
    }));
  }

  if (input.action === 'create') {
    if (!input.name) throw new Error('create requires name');
    if (input.preset === 'github') {
      const { endpoint, secret } = await createGithubWebhookEndpoint(
        opts.tenantId,
        opts.baseUrl,
        input.name,
      );
      return { id: endpoint.id, url: endpoint.url, secret };
    }
    if (!input.source) throw new Error('create requires source (or preset=github)');
    const { endpoint, secret } = await createWebhookEndpoint(
      opts.tenantId,
      {
        name: input.name,
        source: input.source,
        eventKeyExpr: input.eventKeyExpr ?? 'type',
        signatureHeader: input.signatureHeader ?? 'X-Signature-256',
      },
      opts.baseUrl,
    );
    return { id: endpoint.id, url: endpoint.url, secret };
  }

  if (input.action === 'delete') {
    if (!input.id) throw new Error('delete requires id');
    const ok = await deleteWebhookEndpoint(opts.tenantId, input.id);
    return { ok };
  }

  throw new Error(`Unsupported webhook action: ${input.action}`);
}

async function runAutomationAction(
  input: ConfigInput,
  opts: { tenantId: string; userId: string; queue: QueuePort },
) {
  if (input.action === 'list') {
    const rows = await listAutomations(opts.tenantId, opts.userId);
    return rows.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      enabled: a.enabled,
      cron: a.cron,
    }));
  }

  if (input.action === 'create') {
    if (!input.name || !input.prompt) throw new Error('create requires name and prompt');
    const row = await createAutomation(opts.tenantId, opts.userId, {
      name: input.name,
      kind: input.kind ?? 'cron',
      agentId: input.agentId ?? DEFAULT_AGENT_ID,
      prompt: input.prompt,
      enabled: input.enabled ?? true,
      cron: input.cron,
      timezone: input.timezone ?? 'UTC',
      sourceType: input.sourceType,
      eventOn: input.eventOn,
      eventFilter: input.eventFilter,
    });
    if (row.enabled && row.kind === 'cron' && row.cron) {
      await registerAutomationSchedule(opts.queue, row.id, row.cron, row.timezone ?? 'UTC', {
        tenantId: opts.tenantId,
        automationId: row.id,
        eventContext: {},
      });
    }
    return { id: row.id, name: row.name };
  }

  if (input.action === 'update') {
    if (!input.id) throw new Error('update requires id');
    const row = await updateAutomation(opts.tenantId, input.id, {
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.prompt != null ? { prompt: input.prompt } : {}),
      ...(input.cron != null ? { cron: input.cron } : {}),
      ...(input.timezone != null ? { timezone: input.timezone } : {}),
      ...(input.sourceType != null ? { sourceType: input.sourceType } : {}),
      ...(input.eventOn != null ? { eventOn: input.eventOn } : {}),
      ...(input.eventFilter != null ? { eventFilter: input.eventFilter } : {}),
      ...(input.enabled != null ? { enabled: input.enabled } : {}),
    });
    if (!row) return { ok: false };
    if (row.kind === 'cron') {
      await unregisterAutomationSchedule(opts.queue, row.id);
      if (row.enabled && row.cron) {
        await registerAutomationSchedule(opts.queue, row.id, row.cron, row.timezone ?? 'UTC', {
          tenantId: opts.tenantId,
          automationId: row.id,
          eventContext: {},
        });
      }
    }
    return { ok: true };
  }

  if (input.action === 'set_enabled') {
    if (!input.id || input.enabled === undefined) {
      throw new Error('set_enabled requires id and enabled');
    }
    const row = await updateAutomation(opts.tenantId, input.id, { enabled: input.enabled });
    if (!row) return { ok: false };
    if (row.kind === 'cron' && row.cron) {
      if (row.enabled) {
        await registerAutomationSchedule(opts.queue, row.id, row.cron, row.timezone ?? 'UTC', {
          tenantId: opts.tenantId,
          automationId: row.id,
          eventContext: {},
        });
      } else {
        await unregisterAutomationSchedule(opts.queue, row.id);
      }
    }
    return { ok: true };
  }

  if (input.action === 'trigger') {
    if (!input.id) throw new Error('trigger requires id');
    const row = await getAutomation(opts.tenantId, input.id);
    if (!row) return { ok: false, jobId: null };
    const jobId = await dispatchAutomation(opts.queue, {
      tenantId: opts.tenantId,
      automationId: row.id,
      eventContext: { manual: true },
    });
    return { ok: true, jobId: jobId ?? null };
  }

  if (input.action === 'delete') {
    if (!input.id) throw new Error('delete requires id');
    const existing = await getAutomation(opts.tenantId, input.id);
    if (!existing) return { ok: false };
    const ok = await deleteAutomation(opts.tenantId, input.id);
    if (existing.kind === 'cron') {
      await unregisterAutomationSchedule(opts.queue, input.id);
    }
    return { ok };
  }

  throw new Error(`Unsupported automation action: ${input.action}`);
}
