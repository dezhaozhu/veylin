import path from 'node:path';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { toNodeHandler } from 'better-auth/node';
import { ensureDataDir } from '@veylin/db';
import type { AuthHandle } from './auth.js';
import { setAuth } from './auth.js';

/**
 * Persist better-auth users/sessions in VEYLIN_DATA_DIR/auth.sqlite.
 */
export function initLocalPasswordAuth(): AuthHandle {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error('AUTH_SECRET is required for local identity provider');
  }
  const baseURL = process.env.AUTH_BASE_URL?.trim() || `http://127.0.0.1:${process.env.PORT ?? 8787}`;
  const dbPath = path.join(ensureDataDir(), 'auth.sqlite');
  const sqlite = new Database(dbPath);

  const instance = betterAuth({
    database: sqlite,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === '1',
    },
    secret,
    baseURL,
  });

  const handle = instance as unknown as AuthHandle;
  setAuth(handle);
  console.info(`[auth] local password provider ready (sqlite=${dbPath})`);
  return handle;
}

export { toNodeHandler };
