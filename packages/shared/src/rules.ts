import { z } from 'zod';

export const ruleTriggerSchema = z.enum(['always', 'keyword']);
export type RuleTrigger = z.infer<typeof ruleTriggerSchema>;

export const ruleSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  userId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  name: z.string(),
  content: z.string(),
  trigger: ruleTriggerSchema,
  keywords: z.array(z.string()),
  enabled: z.boolean(),
  createdAt: z.string().optional(),
});

export type Rule = z.infer<typeof ruleSchema>;

export const ruleInputSchema = z.object({
  name: z.string().min(1),
  content: z.string().min(1),
  trigger: ruleTriggerSchema.default('always'),
  keywords: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  userId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
});

export type RuleInput = z.infer<typeof ruleInputSchema>;
