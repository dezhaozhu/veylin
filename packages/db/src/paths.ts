import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** Resolve the app-data directory for embedded SurrealDB / LibSQL files. */
export function resolveDataDir(): string {
  const fromEnv = process.env.VEYLIN_DATA_DIR?.trim();
  if (fromEnv) {
    if (isAbsolute(fromEnv)) return fromEnv;
    const anchor = process.env.VEYLIN_REPO_ROOT?.trim();
    if (anchor) return resolve(anchor, fromEnv);
    return resolve(fromEnv);
  }
  return join(homedir(), '.veylin');
}

export function ensureDataDir(): string {
  const dir = resolveDataDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function toUrlPath(...segments: string[]): string {
  return join(...segments).replace(/\\/g, '/');
}

export function surrealKvUrl(dataDir?: string): string {
  const dir = dataDir ?? ensureDataDir();
  return `surrealkv://${toUrlPath(dir, 'veylin')}`;
}

export function mastraLibsqlUrl(dataDir?: string): string {
  const dir = dataDir ?? ensureDataDir();
  return `file:${toUrlPath(dir, 'mastra-memory.db')}`;
}
