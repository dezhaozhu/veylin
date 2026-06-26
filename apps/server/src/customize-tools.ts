import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Runtime } from '@veylin/runtime';
import type { QueuePort } from './queue';
import {
  createCustomSkill,
  deleteCustomSkill,
  getDisabledMcpServers,
  getDisabledSkills,
  listMergedSkills,
  setDisabledMcpServers,
  setDisabledSkills,
  updateCustomSkill,
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
import { buildAutomationTools } from './automation-tools';

interface CustomizeCtx {
  requestContext?: { get(key: string): unknown };
}

function ctxValue(ctx: CustomizeCtx | undefined, key: string): string | undefined {
  return ctx?.requestContext?.get(key) as string | undefined;
}

export interface BuildCustomizeToolsOptions {
  runtime: Runtime;
  boss: QueuePort;
  onMcpRebuild: (tenantId: string) => Promise<void>;
  defaultBaseUrl?: string;
}

export function buildCustomizeTools(opts: BuildCustomizeToolsOptions) {
  const { runtime, boss, onMcpRebuild, defaultBaseUrl = 'http://127.0.0.1:8787' } = opts;

  const skillList = createTool({
    id: 'skill_list',
    description: 'List all skills (built-in and custom) with id, name, description, source, and enabled state.',
    inputSchema: z.object({
      agentId: z.string().default('veylin'),
    }),
    outputSchema: z.object({
      skills: z.array(
        z.object({
          id: z.string().optional(),
          name: z.string(),
          description: z.string(),
          source: z.enum(['bundled', 'custom']),
          enabled: z.boolean(),
        }),
      ),
    }),
    execute: async (input, ctx?: CustomizeCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const rows = await listMergedSkills(runtime, tenantId, input.agentId ?? 'veylin');
      return {
        skills: rows.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          source: s.source,
          enabled: s.enabled,
        })),
      };
    },
  });

  const skillCreate = createTool({
    id: 'skill_create',
    description:
      'Create a custom skill (knowledge block) the agent can activate during chat. ' +
      'Content should be a SKILL.md-style document; include YAML frontmatter with name and description when possible.',
    inputSchema: z.object({
      name: z.string().min(1),
      description: z.string().default(''),
      content: z.string().min(1),
      enabled: z.boolean().default(true),
    }),
    outputSchema: z.object({ id: z.string(), name: z.string() }),
    execute: async (input, ctx?: CustomizeCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const row = await createCustomSkill(tenantId, {
        name: input.name,
        description: input.description ?? '',
        content: input.content,
        enabled: input.enabled ?? true,
      });
      return { id: row.id, name: row.name };
    },
  });

  const skillUpdate = createTool({
    id: 'skill_update',
    description: 'Update a custom skill by id (from skill_list). Built-in skills cannot be edited.',
    inputSchema: z.object({
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      content: z.string().optional(),
      enabled: z.boolean().optional(),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (input, ctx?: CustomizeCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const { id, ...patch } = input;
      const row = await updateCustomSkill(tenantId, id, patch);
      return { ok: row != null };
    },
  });

  const skillDelete = createTool({
    id: 'skill_delete',
    description: 'Delete a custom skill by id. Built-in skills cannot be deleted; use skill_set_enabled to disable them.',
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (input, ctx?: CustomizeCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const ok = await deleteCustomSkill(tenantId, input.id);
      return { ok };
    },
  });

  const skillSetEnabled = createTool({
    id: 'skill_set_enabled',
    description: 'Enable or disable a skill by name (works for both built-in and custom skills).',
    inputSchema: z.object({
      name: z.string(),
      enabled: z.boolean(),
      agentId: z.string().default('veylin'),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (input, ctx?: CustomizeCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const rows = await listMergedSkills(runtime, tenantId, input.agentId ?? 'veylin');
      const hit = rows.find((s) => s.name === input.name);
      if (!hit) return { ok: false };

      if (hit.source === 'bundled') {
        const disabled = new Set(await getDisabledSkills(tenantId));
        if (input.enabled) disabled.delete(input.name);
        else disabled.add(input.name);
        await setDisabledSkills(tenantId, [...disabled]);
        return { ok: true };
      }

      if (!hit.id) return { ok: false };
      const row = await updateCustomSkill(tenantId, hit.id, { enabled: input.enabled });
      return { ok: row != null };
    },
  });

  const mcpServerList = createTool({
    id: 'mcp_server_list',
    description: 'List remote MCP servers configured for this workspace.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      servers: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          transport: z.string(),
          url: z.string(),
          enabled: z.boolean(),
        }),
      ),
    }),
    execute: async (_input, ctx?: CustomizeCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const servers = await listRemoteMcpServers(tenantId);
      return {
        servers: servers.map((s) => ({
          id: s.id,
          name: s.name,
          transport: s.transport,
          url: s.url,
          enabled: s.enabled,
        })),
      };
    },
  });

  const mcpServerCreate = createTool({
    id: 'mcp_server_create',
    description:
      'Add a remote MCP server (SSE or HTTP transport). After creation, MCP tools are available on the next chat turn.',
    inputSchema: z.object({
      name: z.string().min(1),
      transport: z.enum(['sse', 'http']),
      url: z.string().url(),
      headers: z.record(z.string(), z.string()).default({}),
      enabled: z.boolean().default(true),
    }),
    outputSchema: z.object({ id: z.string(), name: z.string() }),
    execute: async (input, ctx?: CustomizeCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const server = await createRemoteMcpServer(tenantId, {
        name: input.name,
        transport: input.transport,
        url: input.url,
        headers: input.headers ?? {},
        enabled: input.enabled ?? true,
      });
      await onMcpRebuild(tenantId);
      return { id: server.id, name: server.name };
    },
  });

  const mcpServerUpdate = createTool({
    id: 'mcp_server_update',
    description: 'Update a remote MCP server by id.',
    inputSchema: z.object({
      id: z.string(),
      name: z.string().optional(),
      transport: z.enum(['sse', 'http']).optional(),
      url: z.string().url().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      enabled: z.boolean().optional(),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (input, ctx?: CustomizeCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const { id, ...patch } = input;
      const server = await updateRemoteMcpServer(tenantId, id, patch);
      if (server) await onMcpRebuild(tenantId);
      return { ok: server != null };
    },
  });

  const mcpServerDelete = createTool({
    id: 'mcp_server_delete',
    description: 'Delete a remote MCP server by id.',
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (input, ctx?: CustomizeCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const ok = await deleteRemoteMcpServer(tenantId, input.id);
      if (ok) await onMcpRebuild(tenantId);
      return { ok };
    },
  });

  const mcpServerSetEnabled = createTool({
    id: 'mcp_server_set_enabled',
    description: 'Enable or disable an MCP server by name (remote servers or built-in stdio servers).',
    inputSchema: z.object({
      name: z.string(),
      enabled: z.boolean(),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (input, ctx?: CustomizeCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const remote = await listRemoteMcpServers(tenantId);
      const hit = remote.find((s) => s.name === input.name);
      if (hit) {
        const server = await updateRemoteMcpServer(tenantId, hit.id, { enabled: input.enabled });
        if (server) await onMcpRebuild(tenantId);
        return { ok: server != null };
      }

      const disabled = new Set(await getDisabledMcpServers(tenantId));
      if (input.enabled) disabled.delete(input.name);
      else disabled.add(input.name);
      await setDisabledMcpServers(tenantId, [...disabled]);
      await onMcpRebuild(tenantId);
      return { ok: true };
    },
  });

  const webhookList = createTool({
    id: 'webhook_list',
    description: 'List event webhook endpoints for event-driven automations.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      endpoints: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          source: z.string(),
          url: z.string(),
          enabled: z.boolean(),
        }),
      ),
    }),
    execute: async (_input, ctx?: CustomizeCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const baseUrl = ctxValue(ctx, 'publicBaseUrl') ?? defaultBaseUrl;
      const endpoints = await listWebhookEndpoints(tenantId, baseUrl);
      return {
        endpoints: endpoints.map((e) => ({
          id: e.id,
          name: e.name,
          source: e.source,
          url: e.url,
          enabled: e.enabled,
        })),
      };
    },
  });

  const webhookCreate = createTool({
    id: 'webhook_create',
    description:
      'Create a webhook endpoint for event-driven automations. Returns the URL and signing secret (show secret once to the user).',
    inputSchema: z.object({
      name: z.string().min(1),
      source: z
        .string()
        .min(1)
        .describe('Lowercase slug, e.g. deploy-hook. Use preset=github for GitHub.'),
      preset: z.enum(['github']).optional(),
      eventKeyExpr: z.string().default('type'),
      signatureHeader: z.string().default('X-Signature-256'),
    }),
    outputSchema: z.object({
      id: z.string(),
      url: z.string(),
      secret: z.string().nullable(),
    }),
    execute: async (input, ctx?: CustomizeCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const baseUrl = ctxValue(ctx, 'publicBaseUrl') ?? defaultBaseUrl;

      if (input.preset === 'github') {
        const { endpoint, secret } = await createGithubWebhookEndpoint(tenantId, baseUrl, input.name);
        return { id: endpoint.id, url: endpoint.url, secret };
      }

      const { endpoint, secret } = await createWebhookEndpoint(
        tenantId,
        {
          name: input.name,
          source: input.source,
          eventKeyExpr: input.eventKeyExpr ?? 'type',
          signatureHeader: input.signatureHeader ?? 'X-Signature-256',
        },
        baseUrl,
      );
      return { id: endpoint.id, url: endpoint.url, secret };
    },
  });

  const webhookDelete = createTool({
    id: 'webhook_delete',
    description: 'Delete a webhook endpoint by id.',
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (input, ctx?: CustomizeCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const ok = await deleteWebhookEndpoint(tenantId, input.id);
      return { ok };
    },
  });

  const automationTools = buildAutomationTools(boss);

  return {
    skill_list: skillList,
    skill_create: skillCreate,
    skill_update: skillUpdate,
    skill_delete: skillDelete,
    skill_set_enabled: skillSetEnabled,
    mcp_server_list: mcpServerList,
    mcp_server_create: mcpServerCreate,
    mcp_server_update: mcpServerUpdate,
    mcp_server_delete: mcpServerDelete,
    mcp_server_set_enabled: mcpServerSetEnabled,
    webhook_list: webhookList,
    webhook_create: webhookCreate,
    webhook_delete: webhookDelete,
    ...automationTools,
  };
}
