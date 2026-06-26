import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface ModelCatalogEntry {
  id: string;
  label: string;
  modelId: string;
  url: string;
  apiKey: string;
  default?: boolean;
}

type CatalogFile = {
  models?: ModelCatalogEntry[];
};

let cached: { path: string; mtimeMs: number; models: ModelCatalogEntry[] } | null = null;

function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, '');
  if (trimmed.endsWith('/v1')) return trimmed;
  if (
    /^https?:\/\/[^/]+:\d+$/i.test(trimmed) ||
    trimmed.includes('api.deepseek.com') ||
    trimmed.includes('zenmux.ai')
  ) {
    return `${trimmed}/v1`;
  }
  return trimmed;
}

function normalizeEntry(raw: ModelCatalogEntry): ModelCatalogEntry | null {
  const id = raw.id?.trim();
  const label = raw.label?.trim() || id;
  const modelId = raw.modelId?.trim();
  const url = raw.url?.trim();
  const apiKey = raw.apiKey?.trim() ?? '';
  if (!id || !modelId || !url || !apiKey) return null;
  return {
    id,
    label,
    modelId,
    url: normalizeUrl(url),
    apiKey,
    default: raw.default === true,
  };
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
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as CatalogFile;
      const models = (parsed.models ?? [])
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
