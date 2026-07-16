import { z } from 'zod';

export const DEFAULT_LANGFUSE_BASE_URL = 'https://cloud.langfuse.com';

/** Tenant Langfuse observability settings (persisted in tenant_settings). */
export const langfuseSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  publicKey: z.string().default(''),
  secretKey: z.string().default(''),
  baseUrl: z.string().default(DEFAULT_LANGFUSE_BASE_URL),
});

export type LangfuseSettingsStored = z.infer<typeof langfuseSettingsSchema>;

/**
 * Patch schema must NOT reuse `.partial()` on a schema with `.default()` —
 * Zod 4 applies those defaults for omitted keys and would wipe stored secrets.
 */
export const langfuseSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  publicKey: z.string().optional(),
  secretKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

export type LangfuseSettingsPatch = z.infer<typeof langfuseSettingsPatchSchema>;