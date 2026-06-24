import { z } from 'zod';

export const automationKindSchema = z.enum(['schedule', 'event']);
export const automationSourceTypeSchema = z.enum(['cron', 'github', 'custom']);
export const automationRunStatusSchema = z.enum(['queued', 'running', 'done', 'failed']);

export const automationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string(),
  name: z.string(),
  kind: automationKindSchema,
  agentId: z.string(),
  prompt: z.string(),
  enabled: z.boolean(),
  cron: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  sourceType: automationSourceTypeSchema.optional(),
  triggerFilter: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().optional(),
  lastRunAt: z.string().nullable().optional(),
});

export type Automation = z.infer<typeof automationSchema>;

export const automationInputSchema = z.object({
  name: z.string().min(1),
  kind: automationKindSchema,
  agentId: z.string().default('veylin'),
  prompt: z.string().min(1),
  enabled: z.boolean().default(true),
  cron: z.string().optional(),
  timezone: z.string().default('UTC'),
  sourceType: automationSourceTypeSchema.optional(),
  triggerFilter: z.record(z.string(), z.unknown()).default({}),
});

export type AutomationInput = z.infer<typeof automationInputSchema>;

export const automationRunSchema = z.object({
  id: z.string().uuid(),
  automationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  threadId: z.string(),
  status: automationRunStatusSchema,
  result: z.string().nullable().optional(),
  eventContext: z.record(z.string(), z.unknown()).default({}),
  startedAt: z.string(),
  finishedAt: z.string().nullable().optional(),
});

export type AutomationRun = z.infer<typeof automationRunSchema>;

export const webhookEndpointSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  token: z.string(),
  sourceType: z.enum(['github', 'custom']),
  url: z.string(),
  createdAt: z.string().optional(),
});

export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;
