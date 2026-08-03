import { Surreal } from 'surrealdb';
import { surrealdbNodeEngines } from '@surrealdb/node';
import { ensureDataDir, surrealKvUrl } from './paths';
import { initSchema } from './init-schema';
import { ensureChunkVectorIndex } from './vector-index';

let db: Surreal | undefined;
let initPromise: Promise<Surreal> | undefined;

export async function connectDb(): Promise<Surreal> {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const dataDir = ensureDataDir();
    const instance = new Surreal({ engines: surrealdbNodeEngines({ capabilities: { guest_access: true } }) });
    await instance.connect(surrealKvUrl(dataDir));
    await instance.use({ namespace: 'ia', database: 'main' });
    await initSchema(instance);
    await ensureChunkVectorIndex(instance);
    db = instance;
    console.log('[db] SurrealDB ready at', dataDir);
    return instance;
  })();

  return initPromise;
}

/** Synchronous accessor after {@link connectDb} has resolved at least once. */
export function getDb(): Surreal {
  if (!db) {
    throw new Error('Database not initialized; call connectDb() during server boot');
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.close();
    db = undefined;
    initPromise = undefined;
  }
}

export type Database = Surreal;
