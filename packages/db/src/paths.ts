import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

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

/**
 * SurrealKV URL for the embedded store.
 * On Windows, `surrealkv://D:/...` is parsed as host `D` and creates a relative
 * `./D/...` folder under cwd. Prefer a cwd-relative path when possible.
 */
export function surrealKvUrl(dataDir?: string): string {
  const dir = dataDir ?? ensureDataDir();
  const store = join(dir, 'veylin');
  const abs = toUrlPath(store);
  if (/^[A-Za-z]:\//.test(abs)) {
    const rel = toUrlPath(relative(process.cwd(), store));
    if (rel && rel !== '.' && !/^[A-Za-z]:\//.test(rel)) {
      return `surrealkv://${rel}`;
    }
  }
  return `surrealkv://${abs}`;
}

export function mastraLibsqlUrl(dataDir?: string): string {
  const dir = dataDir ?? ensureDataDir();
  return `file:${toUrlPath(dir, 'mastra-memory.db')}`;
}
