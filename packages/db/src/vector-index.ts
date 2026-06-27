import type { Surreal } from 'surrealdb';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { queryRows } from './query';
import { resolveDataDir } from './paths';

/** Must match fastembed output dimension (BGE-small / similar). */
export const CHUNK_EMBEDDING_DIMENSION = 384;

const INDEX_NAME = 'chunk_embedding_hnsw';
const REBUILD_MARKER = 'chunk_hnsw_v1.done';

let hnswVerified = false;

export function isHnswVectorIndexReady(): boolean {
  return hnswVerified;
}

/**
 * Ensure the chunk embedding HNSW index exists with the correct definition and
 * rebuild once so embeddings inserted before the index was added are indexed.
 */
export async function ensureChunkVectorIndex(db: Surreal): Promise<void> {
  await db.query(
    `DEFINE INDEX OVERWRITE ${INDEX_NAME} ON chunk FIELDS embedding HNSW DIMENSION ${CHUNK_EMBEDDING_DIMENSION} DIST COSINE EFC 150 M 12`,
  );

  const markerPath = join(resolveDataDir(), REBUILD_MARKER);
  if (!existsSync(markerPath)) {
    const chunks = await queryRows<Record<string, unknown>>(
      db,
      'SELECT id FROM chunk WHERE embedding != NONE LIMIT 1',
      {},
    );
    if (chunks.length > 0) {
      await db.query(`REBUILD INDEX ${INDEX_NAME} ON chunk`);
      console.log('[db] rebuilt chunk HNSW index for existing embeddings');
    }
    writeFileSync(markerPath, new Date().toISOString(), 'utf8');
  }

  // Smoke-test: empty result is fine; failure means the index/query path is broken.
  const probe = Array.from({ length: CHUNK_EMBEDDING_DIMENSION }, () => 0);
  await db.query(
    `SELECT id, vector::distance::knn() AS dist FROM chunk
     WHERE embedding <|1, 16|> $probe
     LIMIT 1`,
    { probe },
  );
  hnswVerified = true;
  console.log(
    `[db] chunk HNSW vector index ready (dim=${CHUNK_EMBEDDING_DIMENSION}, cosine)`,
  );
}
