import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { installIdPath } from './paths.js';

/**
 * Stable desktop install id. Created once; never deleted on logout.
 * Used as local thread resourceId (not the Platform user id).
 */
export function getOrCreateInstallId(): string {
  const path = installIdPath();
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8').trim();
    if (raw) return raw;
  }
  const id = randomUUID();
  writeFileSync(path, `${id}\n`, 'utf8');
  return id;
}
