import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDataDir } from '@veylin/db';

/** `{VEYLIN_DATA_DIR}/desktop-auth/` — installId + encrypted session. */
export function desktopAuthDir(): string {
  const dir = join(ensureDataDir(), 'desktop-auth');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function installIdPath(): string {
  return join(desktopAuthDir(), 'install-id');
}

export function sessionPath(): string {
  return join(desktopAuthDir(), 'session.json');
}
