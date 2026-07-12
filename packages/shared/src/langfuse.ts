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

export const langfuseSettingsPatchSchema = langfuseSettingsSchema.partial();

export type LangfuseSettingsPatch = z.infer<typeof langfuseSettingsPatchSchema>;
