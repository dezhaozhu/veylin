import { z } from 'zod';

export const automationKindSchema = z.enum(['schedule', 'event']);
/** Schedule automations use `cron`; event automations use a webhook source slug (e.g. `github`, `linear`). */
export const automationSourceTypeSchema = z.union([z.literal('cron'), z.string().min(1)]);
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
  /** OpenHands-style event key pattern(s), e.g. `pull_request.opened` or `pull_request.*` */
  eventOn: z.union([z.string(), z.array(z.string())]).optional(),
  /** JMESPath filter evaluated against the webhook payload */
  eventFilter: z.string().optional(),
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
  /** OpenHands-style event key pattern(s), e.g. `pull_request.opened` or `pull_request.*` */
  eventOn: z.union([z.string(), z.array(z.string())]).optional(),
  /** JMESPath filter evaluated against the webhook payload */
  eventFilter: z.string().optional(),
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
