import { z } from 'zod';

export const pluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  author: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
    })
    .or(z.string())
    .optional(),
  /** Relative path to Codex-style `.mcp.json` (default: `./.mcp.json` when present). */
  mcpServers: z.string().optional(),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export const pluginInstallSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  version: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  sourceType: z.enum(['path', 'git', 'marketplace']),
  source: z.string(),
  installPath: z.string(),
  enabled: z.boolean(),
  createdAt: z.string().optional(),
});

export type PluginInstall = z.infer<typeof pluginInstallSchema>;

export const marketplaceEntrySchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  version: z.string().optional(),
  source: z.object({
    type: z.enum(['path', 'git']),
    url: z.string(),
  }),
});

export type MarketplaceEntry = z.infer<typeof marketplaceEntrySchema>;
