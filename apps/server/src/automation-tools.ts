import { createTool } from '@mastra/core/tools';
import { DEFAULT_AGENT_ID } from '@veylin/shared';
import { z } from 'zod';
import { llmBool } from './zod-llm.js';
import type { QueuePort } from './queue';
import {
  createAutomation,
  listAutomations,
  updateAutomation,
  deleteAutomation,
  getAutomation,
} from './automation-store';
import { dispatchAutomation } from './automation-worker';
import {
  registerAutomationSchedule,
  unregisterAutomationSchedule,
} from './queue';

interface AutoCtx {
  requestContext?: { get(key: string): unknown };
}

function ctxValue(ctx: AutoCtx | undefined, key: string): string | undefined {
  return ctx?.requestContext?.get(key) as string | undefined;
}

export function buildAutomationTools(boss: QueuePort) {
  const automationCreate = createTool({
    id: 'automation_create',
    description:
      'Create a scheduled or event-driven automation that runs an agent prompt automatically.',
    inputSchema: z.object({
      name: z.string(),
      kind: z.enum(['cron', 'event']).default('cron'),
      agentId: z.string().default(DEFAULT_AGENT_ID),
      prompt: z.string(),
      cron: z.string().optional().describe('Cron expression for schedule kind'),
      timezone: z.string().default('UTC'),
      sourceType: z.union([z.literal('cron'), z.string().min(1)]).optional(),
      eventOn: z.union([z.string(), z.array(z.string())]).optional(),
      eventFilter: z.string().optional(),
      enabled: llmBool().default(true),
    }),
    outputSchema: z.object({ id: z.string(), name: z.string() }),
    execute: async (input, ctx?: AutoCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const userId = ctxValue(ctx, 'userId') ?? 'dev-user';
      const row = await createAutomation(tenantId, userId, {
        name: input.name,
        kind: input.kind ?? 'cron',
        agentId: input.agentId ?? DEFAULT_AGENT_ID,
        prompt: input.prompt,
        enabled: (input.enabled as boolean | undefined) ?? true,
        cron: input.cron,
        timezone: input.timezone ?? 'UTC',
        sourceType: input.sourceType,
        eventOn: input.eventOn,
        eventFilter: input.eventFilter,
      });
      if (row.enabled && row.kind === 'cron' && row.cron) {
        await registerAutomationSchedule(boss, row.id, row.cron, row.timezone ?? 'UTC', {
          tenantId,
          automationId: row.id,
          eventContext: {},
        });
      }
      return { id: row.id, name: row.name };
    },
  });

  const automationList = createTool({
    id: 'automation_list',
    description: 'List automations for the current user.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      automations: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          kind: z.string(),
          enabled: z.boolean(),
          cron: z.string().nullable().optional(),
        }),
      ),
    }),
    execute: async (_input, ctx?: AutoCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const userId = ctxValue(ctx, 'userId') ?? 'dev-user';
      const rows = await listAutomations(tenantId, userId);
      return {
        automations: rows.map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          enabled: a.enabled,
          cron: a.cron,
        })),
      };
    },
  });

  const automationEnable = createTool({
    id: 'automation_enable',
    description: 'Enable or disable an automation by id.',
    inputSchema: z.object({
      id: z.string(),
      enabled: llmBool(),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (input, ctx?: AutoCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const row = await updateAutomation(tenantId, input.id, { enabled: input.enabled as boolean | undefined });
      if (!row) return { ok: false };
      if (row.kind === 'cron' && row.cron) {
        if (row.enabled) {
          await registerAutomationSchedule(boss, row.id, row.cron, row.timezone ?? 'UTC', {
            tenantId,
            automationId: row.id,
            eventContext: {},
          });
        } else {
          await unregisterAutomationSchedule(boss, row.id);
        }
      }
      return { ok: true };
    },
  });

  const automationTrigger = createTool({
    id: 'automation_trigger',
    description: 'Manually run an automation now.',
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ ok: z.boolean(), jobId: z.string().nullable() }),
    execute: async (input, ctx?: AutoCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const row = await getAutomation(tenantId, input.id);
      if (!row) return { ok: false, jobId: null };
      const jobId = await dispatchAutomation(boss, {
        tenantId,
        automationId: row.id,
        eventContext: { manual: true },
      });
      return { ok: true, jobId: jobId ?? null };
    },
  });

  const automationUpdate = createTool({
    id: 'automation_update',
    description:
      'Update an existing automation (prompt, schedule, timezone, or event filter). ' +
      'Re-registers the cron schedule when cron/timezone/enabled change.',
    inputSchema: z.object({
      id: z.string(),
      name: z.string().optional(),
      prompt: z.string().optional(),
      cron: z.string().optional().describe('Cron expression for schedule kind'),
      timezone: z.string().optional(),
      sourceType: z.union([z.literal('cron'), z.string().min(1)]).optional(),
      eventOn: z.union([z.string(), z.array(z.string())]).optional(),
      eventFilter: z.string().optional(),
      enabled: llmBool().optional(),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (input, ctx?: AutoCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const { id, ...patch } = input;
      const row = await updateAutomation(tenantId, id, { ...patch, enabled: patch.enabled as boolean | undefined });
      if (!row) return { ok: false };
      if (row.kind === 'cron') {
        await unregisterAutomationSchedule(boss, row.id);
        if (row.enabled && row.cron) {
          await registerAutomationSchedule(boss, row.id, row.cron, row.timezone ?? 'UTC', {
            tenantId,
            automationId: row.id,
            eventContext: {},
          });
        }
      }
      return { ok: true };
    },
  });

  const automationDelete = createTool({
    id: 'automation_delete',
    description: 'Delete an automation by id and remove its schedule.',
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (input, ctx?: AutoCtx) => {
      const tenantId = ctxValue(ctx, 'tenantId') ?? '00000000-0000-0000-0000-000000000000';
      const existing = await getAutomation(tenantId, input.id);
      if (!existing) return { ok: false };
      const ok = await deleteAutomation(tenantId, input.id);
      if (existing.kind === 'cron') {
        await unregisterAutomationSchedule(boss, input.id);
      }
      return { ok };
    },
  });

  return {
    automation_create: automationCreate,
    automation_list: automationList,
    automation_enable: automationEnable,
    automation_trigger: automationTrigger,
    automation_update: automationUpdate,
    automation_delete: automationDelete,
  };
}
