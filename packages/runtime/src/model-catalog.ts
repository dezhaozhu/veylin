import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  modelCatalogEntrySchema,
  modelCatalogFileSchema,
  type ModelCatalogEntry,
} from '@veylin/shared';

export type { ModelCatalogEntry };

type CatalogFile = {
  models?: ModelCatalogEntry[];
};

let cached: { path: string; mtimeMs: number; models: ModelCatalogEntry[] } | null = null;

/** Append `/v1` for bare OpenAI-compatible host URLs (no path). */
export function normalizeOpenAICompatibleUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, '');
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (!parsed.pathname || parsed.pathname === '/') {
      return `${trimmed}/v1`;
    }
  } catch {
    // leave malformed URLs to the provider
  }
  return trimmed;
}

function normalizeEntry(raw: ModelCatalogEntry): ModelCatalogEntry | null {
  const parsed = modelCatalogEntrySchema.safeParse({
    ...raw,
    url: normalizeOpenAICompatibleUrl(raw.url),
  });
  if (!parsed.success) return null;
  return parsed.data;
}

function catalogCandidates(): string[] {
  const paths: Array<string | undefined> = [
    process.env.VEYLIN_MODEL_CATALOG_PATH,
    process.env.VEYLIN_DATA_DIR
      ? resolve(process.env.VEYLIN_DATA_DIR, 'models.local.json')
      : undefined,
    resolve(homedir(), '.veylin/models.local.json'),
    resolve(process.cwd(), 'data/models.local.json'),
  ];
  return paths.filter((p): p is string => Boolean(p?.trim()));
}

export function loadModelCatalog(): ModelCatalogEntry[] {
  for (const path of catalogCandidates()) {
    if (!existsSync(path)) continue;
    try {
      const mtimeMs = statSync(path).mtimeMs;
      if (cached?.path === path && cached.mtimeMs === mtimeMs) {
        return cached.models;
      }
      const parsed = modelCatalogFileSchema.safeParse(
        JSON.parse(readFileSync(path, 'utf8')) as CatalogFile,
      );
      if (!parsed.success) continue;
      const models = parsed.data.models
        .map((m) => normalizeEntry(m))
        .filter((m): m is ModelCatalogEntry => m != null);
      if (models.length > 0) {
        cached = { path, mtimeMs, models };
        return models;
      }
    } catch {
      // try next candidate
    }
  }
  cached = null;
  return [];
}

export function getCatalogModel(id: string): ModelCatalogEntry | undefined {
  return loadModelCatalog().find((m) => m.id === id);
}

export function getDefaultCatalogModel(): ModelCatalogEntry | undefined {
  const models = loadModelCatalog();
  return models.find((m) => m.default) ?? models[0];
}

export function clearModelCatalogCache(): void {
  cached = null;
}

export function listModelCatalogPublic(): Array<{ id: string; label: string; default?: boolean }> {
  return loadModelCatalog().map(({ id, label, default: isDefault }) => ({
    id,
    label,
    ...(isDefault ? { default: true } : {}),
  }));
}
