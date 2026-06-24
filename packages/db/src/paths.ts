import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Resolve the app-data directory for embedded SurrealDB / LibSQL files. */
export function resolveDataDir(): string {
  const fromEnv = process.env.VEYLIN_DATA_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  return join(homedir(), '.veylin');
}

export function ensureDataDir(): string {
  const dir = resolveDataDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function surrealKvUrl(dataDir?: string): string {
  const dir = dataDir ?? ensureDataDir();
  return `surrealkv://${join(dir, 'veylin')}`;
}

export function mastraLibsqlUrl(dataDir?: string): string {
  const dir = dataDir ?? ensureDataDir();
  return `file:${join(dir, 'mastra-memory.db')}`;
}
