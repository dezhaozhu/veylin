import { z } from 'zod';

/** Built-in sources handled by the OpenHands server forwarder (reserved for custom registration). */
export const RESERVED_WEBHOOK_SOURCES = ['github', 'bitbucket_data_center', 'jira_dc'] as const;

const sourceSlugSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$|^[a-z0-9]$/, {
    message: 'Source must be lowercase alphanumeric with hyphens',
  })
  .transform((v) => v.toLowerCase());

const headerNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z][A-Za-z0-9-]{0,98}[A-Za-z0-9]$|^[A-Za-z]$/);

export const webhookEndpointSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  source: z.string(),
  url: z.string(),
  eventKeyExpr: z.string(),
  signatureHeader: z.string(),
  enabled: z.boolean(),
  createdAt: z.string().optional(),
});

export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;

export const webhookCreateInputSchema = z.object({
  name: z.string().min(1).max(255),
  source: sourceSlugSchema.refine(
    (v) => !(RESERVED_WEBHOOK_SOURCES as readonly string[]).includes(v),
    { message: 'Source is reserved. Use the GitHub preset instead.' },
  ),
  eventKeyExpr: z.string().min(1).max(500).default('type'),
  signatureHeader: headerNameSchema.default('X-Signature-256'),
  webhookSecret: z.string().min(8).max(255).optional(),
});

export type WebhookCreateInput = z.infer<typeof webhookCreateInputSchema>;

export const webhookUpdateInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  eventKeyExpr: z.string().min(1).max(500).optional(),
  signatureHeader: headerNameSchema.optional(),
  enabled: z.boolean().optional(),
});

export type WebhookUpdateInput = z.infer<typeof webhookUpdateInputSchema>;

export const githubWebhookPresetSchema = z.object({
  name: z.string().min(1).max(255).default('GitHub'),
});
