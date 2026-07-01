import { existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  process.env.VEYLIN_DOTENV_PATH,
  process.env.VEYLIN_DATA_DIR ? resolve(process.env.VEYLIN_DATA_DIR, '.env') : undefined,
  resolve(moduleDir, '../../../.env'),
  resolve(moduleDir, '../../.env'),
].filter((p): p is string => Boolean(p));

for (const path of envCandidates) {
  if (existsSync(path)) {
    loadEnv({ path });
    break;
  }
}
