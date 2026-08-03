import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { connectDb, closeDb } from './client';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../../.env') });

async function main() {
  await connectDb();
  console.log('[db] SurrealDB schema initialized');
  await closeDb();
}

main().catch((err) => {
  console.error('[db] migration failed:', err);
  process.exit(1);
});
