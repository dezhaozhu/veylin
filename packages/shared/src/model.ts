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

export const modelProviderSettingsPatchSchema = modelProviderSettingsSchema.partial();

export type ModelProviderSettingsPatch = z.infer<typeof modelProviderSettingsPatchSchema>;
