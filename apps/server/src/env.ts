import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Loaded before any module that reads process.env (e.g. auth.ts -> getDb()).
// .env lives at the monorepo root (apps/server/src -> ../../../.env).
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
