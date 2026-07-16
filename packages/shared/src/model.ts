import { z } from 'zod';

/** One OpenAI-compatible model entry in `models.local.json`. */
export const modelCatalogEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  modelId: z.string().min(1),
  url: z.string().min(1),
  apiKey: z.string().min(1),
  default: z.boolean().optional(),
  /** When true, chat may attach images/PDF page renders for this catalog id. */
  vision: z.boolean().optional(),
  /** Optional input context window override (tokens). When omitted, resolved via provider `/models`, known modelId table, or 272k fallback. */
  contextWindow: z.number().int().positive().optional(),
});

export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>;

export const modelCatalogFileSchema = z.object({
  models: z.array(modelCatalogEntrySchema).default([]),
});

export type ModelCatalogFile = z.infer<typeof modelCatalogFileSchema>;

/** Tenant / UI provider settings (single shared OpenAI-compatible endpoint). */
export const modelProviderSettingsSchema = z.object({
  modelName: z.string().default(''),
  requestUrl: z.string().default(''),
  apiKey: z.string().default(''),
});

export type ModelProviderSettingsStored = z.infer<typeof modelProviderSettingsSchema>;

/**
 * Patch schema must NOT reuse `.partial()` on a schema with `.default()` —
 * Zod 4 applies those defaults for omitted keys, which would wipe stored
 * requestUrl/apiKey on a modelName-only update.
 */
export const modelProviderSettingsPatchSchema = z.object({
  modelName: z.string().optional(),
  requestUrl: z.string().optional(),
  apiKey: z.string().optional(),
});

export type ModelProviderSettingsPatch = z.infer<typeof modelProviderSettingsPatchSchema>;

/** Merge patch into existing; omit/blank apiKey keeps the previous key. */
export function mergeModelProviderSettings(
  existing: ModelProviderSettingsStored,
  patch: ModelProviderSettingsPatch,
): ModelProviderSettingsStored {
  const apiKey =
    patch.apiKey !== undefined && patch.apiKey.trim().length > 0 ? patch.apiKey : existing.apiKey;
  return modelProviderSettingsSchema.parse({
    modelName: patch.modelName !== undefined ? patch.modelName : existing.modelName,
    requestUrl: patch.requestUrl !== undefined ? patch.requestUrl : existing.requestUrl,
    apiKey,
  });
}