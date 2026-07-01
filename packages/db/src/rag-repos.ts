import { RecordId } from 'surrealdb';
import { getDb } from './client';
import { newId, normalizeId, queryRows, createRecord, selectById } from './query';
import type {
  AgentCitationRow,
  ChunkRow,
  DocumentRow,
  EntityRow,
  KnowledgeReference,
  RelatesRow,
} from './types';

import { CHUNK_EMBEDDING_DIMENSION, isHnswVectorIndexReady } from './vector-index';

const RRF_K = 60;
const RRF_CANDIDATE_MULTIPLIER = 3;

function mapDocument(r: Record<string, unknown>): DocumentRow {
  return {
    id: normalizeId(r.id),
    tenantId: String(r.tenant_id ?? ''),
    filename: String(r.filename ?? ''),
    mimeType: (r.mime_type as string | null) ?? null,
    sizeBytes: r.size_bytes != null ? Number(r.size_bytes) : null,
    status: (r.status as DocumentRow['status']) ?? 'pending',
    error: (r.error as string | null) ?? null,
    createdAt: r.created_at ? String(r.created_at) : undefined,
  };
}

function mapChunk(r: Record<string, unknown>): ChunkRow {
  return {
    id: normalizeId(r.id),
    documentId: String(r.document_id ?? ''),
    tenantId: String(r.tenant_id ?? ''),
    text: String(r.text ?? ''),
    source: String(r.source ?? ''),
    offset: Number(r.offset ?? 0),
    embedding: (r.embedding as number[] | null) ?? null,
  };
}

export function normalizeEntityKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function mapEntity(r: Record<string, unknown>): EntityRow {
  return {
    id: normalizeId(r.id),
    tenantId: String(r.tenant_id ?? ''),
    name: String(r.name ?? ''),
    nameKey: String(r.name_key ?? normalizeEntityKey(String(r.name ?? ''))),
    type: String(r.type ?? 'concept'),
    description: (r.description as string | null) ?? null,
    documentId: (r.document_id as string | null) ?? null,
  };
}

function mapRelates(r: Record<string, unknown>): RelatesRow {
  return {
    id: normalizeId(r.id),
    tenantId: String(r.tenant_id ?? ''),
    fromEntityId: normalizeId(r.in ?? r.from_entity_id ?? ''),
    toEntityId: normalizeId(r.out ?? r.to_entity_id ?? ''),
    relation: String(r.relation ?? ''),
    documentId: (r.document_id as string | null) ?? null,
  };
}

function mapCitation(r: Record<string, unknown>): AgentCitationRow {
  return {
    id: normalizeId(r.id),
    tenantId: String(r.tenant_id ?? ''),
    threadId: (r.thread_id as string | null) ?? null,
    query: String(r.query ?? ''),
    references: Array.isArray(r.references) ? (r.references as KnowledgeReference[]) : [],
    createdAt: r.created_at ? String(r.created_at) : undefined,
  };
}

function chunkToReference(chunk: ChunkRow, score: number): Omit<KnowledgeReference, 'refIndex'> {
  return {
    chunkId: chunk.id,
    documentId: chunk.documentId,
    source: chunk.source,
    text: chunk.text,
    offset: chunk.offset,
    score,
  };
}

function reciprocalRankFusion(
  lists: Array<Array<Omit<KnowledgeReference, 'refIndex'>>>,
  limit = 8,
): Omit<KnowledgeReference, 'refIndex'>[] {
  const scores = new Map<string, { score: number; ref: Omit<KnowledgeReference, 'refIndex'> }>();
  for (const list of lists) {
    list.forEach((ref, rank) => {
      const rrf = 1 / (RRF_K + rank + 1);
      const prev = scores.get(ref.chunkId);
      scores.set(ref.chunkId, {
        score: (prev?.score ?? 0) + rrf,
        ref: prev?.ref ?? ref,
      });
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({ ...entry.ref, score: entry.score }));
}

function withRefIndexes(refs: Omit<KnowledgeReference, 'refIndex'>[]): KnowledgeReference[] {
  return refs.map((ref, index) => ({ ...ref, refIndex: index + 1 }));
}

export async function listDocuments(tenantId: string): Promise<DocumentRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM document WHERE tenant_id = $tenantId ORDER BY created_at DESC',
    { tenantId },
  );
  return rows.map(mapDocument);
}

export async function getDocument(id: string): Promise<DocumentRow | null> {
  const row = await selectById<Record<string, unknown>>(getDb(), 'document', id);
  return row ? mapDocument(row) : null;
}

export async function insertDocument(
  tenantId: string,
  input: { filename: string; mimeType?: string; sizeBytes?: number },
): Promise<DocumentRow> {
  const id = newId();
  await createRecord(getDb(), 'document', {
    id,
    tenant_id: tenantId,
    filename: input.filename,
    mime_type: input.mimeType ?? null,
    size_bytes: input.sizeBytes ?? null,
    status: 'pending',
  });
  return (await getDocument(id))!;
}

export async function updateDocumentStatus(
  id: string,
  status: DocumentRow['status'],
  error?: string | null,
): Promise<void> {
  if (error) {
    await getDb().query('UPDATE type::thing($table, $id) SET status = $status, error = $error', {
      table: 'document',
      id,
      status,
      error,
    });
    return;
  }
  await getDb().query('UPDATE type::thing($table, $id) SET status = $status, error = NONE', {
    table: 'document',
    id,
    status,
  });
}

export async function deleteDocument(tenantId: string, documentId: string): Promise<boolean> {
  const doc = await getDocument(documentId);
  if (!doc || doc.tenantId !== tenantId) return false;

  const db = getDb();
  await db.query('DELETE chunk_entity WHERE document_id = $documentId AND tenant_id = $tenantId', {
    documentId,
    tenantId,
  });
  await db.query('DELETE chunk WHERE document_id = $documentId AND tenant_id = $tenantId', {
    documentId,
    tenantId,
  });
  await db.query('DELETE relates WHERE document_id = $documentId AND tenant_id = $tenantId', {
    documentId,
    tenantId,
  });
  await db.query('DELETE entity WHERE document_id = $documentId AND tenant_id = $tenantId', {
    documentId,
    tenantId,
  });
  await db.query('DELETE type::thing($table, $id) WHERE tenant_id = $tenantId', {
    table: 'document',
    id: documentId,
    tenantId,
  });
  return true;
}

export async function insertChunk(row: Omit<ChunkRow, 'id'> & { id?: string }): Promise<ChunkRow> {
  const id = row.id ?? newId();
  await createRecord(getDb(), 'chunk', {
    id,
    document_id: row.documentId,
    tenant_id: row.tenantId,
    text: row.text,
    source: row.source,
    offset: row.offset,
    embedding: row.embedding ?? null,
  });
  return mapChunk((await selectById<Record<string, unknown>>(getDb(), 'chunk', id))!);
}

export async function searchChunksByText(
  tenantId: string,
  query: string,
  limit = 8,
): Promise<ChunkRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM chunk WHERE tenant_id = $tenantId AND string::contains(string::lowercase(text), string::lowercase($query)) LIMIT $limit',
    { tenantId, query, limit },
  );
  return rows.map(mapChunk);
}

export async function searchChunksByVector(
  tenantId: string,
  embedding: number[],
  limit = 8,
): Promise<Array<{ chunk: ChunkRow; sim: number }>> {
  if (embedding.length !== CHUNK_EMBEDDING_DIMENSION) {
    console.warn(
      `[rag] query embedding dim ${embedding.length} != ${CHUNK_EMBEDDING_DIMENSION}, using brute-force`,
    );
    return searchChunksByVectorBruteForce(tenantId, embedding, limit);
  }
  if (!isHnswVectorIndexReady()) {
    return searchChunksByVectorBruteForce(tenantId, embedding, limit);
  }
  try {
    const k = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = await queryRows<Record<string, unknown>>(
      getDb(),
      `SELECT *, vector::distance::knn() AS dist FROM chunk
       WHERE tenant_id = $tenantId AND embedding <|${k}, 40|> $embedding
       ORDER BY dist`,
      { tenantId, embedding },
    );
    return rows.map((r) => ({
      chunk: mapChunk(r),
      sim: Math.max(0, 1 - Number(r.dist ?? 1)),
    }));
  } catch (err) {
    console.warn('[rag] HNSW vector search failed, falling back to brute-force:', err);
    return searchChunksByVectorBruteForce(tenantId, embedding, limit);
  }
}

async function searchChunksByVectorBruteForce(
  tenantId: string,
  embedding: number[],
  limit = 8,
): Promise<Array<{ chunk: ChunkRow; sim: number }>> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM chunk WHERE tenant_id = $tenantId AND embedding != NONE',
    { tenantId },
  );
  return rows
    .map((r) => {
      const emb = r.embedding as number[] | null;
      if (!emb?.length) return null;
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let i = 0; i < Math.min(emb.length, embedding.length); i++) {
        dot += emb[i]! * embedding[i]!;
        na += emb[i]! * emb[i]!;
        nb += embedding[i]! * embedding[i]!;
      }
      const sim = dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
      return { chunk: mapChunk(r), sim };
    })
    .filter((x): x is { chunk: ChunkRow; sim: number } => x != null)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit);
}

export async function upsertEntity(row: {
  tenantId: string;
  name: string;
  type: string;
  description?: string | null;
  documentId: string;
}): Promise<EntityRow> {
  const nameKey = normalizeEntityKey(row.name);
  const existing = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM entity WHERE tenant_id = $tenantId AND document_id = $documentId AND name_key = $nameKey LIMIT 1',
    { tenantId: row.tenantId, documentId: row.documentId, nameKey },
  );
  if (existing[0]) {
    const current = mapEntity(existing[0]);
    const nextDescription =
      row.description && (!current.description || row.description.length > current.description.length)
        ? row.description
        : current.description;
    if (nextDescription !== current.description || current.type === 'concept' && row.type !== 'concept') {
      await getDb().query(
        'UPDATE type::thing($table, $id) SET description = $description, type = $type',
        {
          table: 'entity',
          id: current.id,
          description: nextDescription ?? null,
          type: row.type || current.type,
        },
      );
      return {
        ...current,
        description: nextDescription ?? null,
        type: row.type || current.type,
      };
    }
    return current;
  }

  const id = newId();
  await createRecord(getDb(), 'entity', {
    id,
    tenant_id: row.tenantId,
    name: row.name.trim(),
    name_key: nameKey,
    type: row.type,
    description: row.description ?? null,
    document_id: row.documentId,
  });
  return mapEntity((await selectById<Record<string, unknown>>(getDb(), 'entity', id))!);
}

export async function insertEntity(row: Omit<EntityRow, 'id' | 'nameKey'> & { id?: string }): Promise<EntityRow> {
  return upsertEntity({
    tenantId: row.tenantId,
    name: row.name,
    type: row.type,
    description: row.description,
    documentId: row.documentId ?? '',
  });
}

export async function linkChunkEntity(row: {
  tenantId: string;
  documentId: string;
  chunkId: string;
  entityId: string;
}): Promise<void> {
  const existing = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM chunk_entity WHERE chunk_id = $chunkId AND entity_id = $entityId LIMIT 1',
    { chunkId: row.chunkId, entityId: row.entityId },
  );
  if (existing.length > 0) return;
  await createRecord(getDb(), 'chunk_entity', {
    id: newId(),
    chunk_id: row.chunkId,
    entity_id: row.entityId,
    tenant_id: row.tenantId,
    document_id: row.documentId,
  });
}

export async function insertRelates(row: {
  tenantId: string;
  fromEntityId: string;
  toEntityId: string;
  relation: string;
  documentId?: string | null;
}): Promise<void> {
  await getDb().query(
    'RELATE $from->relates->$to SET tenant_id = $tenantId, relation = $relation, document_id = $documentId',
    {
      from: new RecordId('entity', row.fromEntityId),
      to: new RecordId('entity', row.toEntityId),
      tenantId: row.tenantId,
      relation: row.relation,
      documentId: row.documentId ?? null,
    },
  );
}

export async function searchEntitiesByQuery(
  tenantId: string,
  query: string,
  limit = 6,
): Promise<EntityRow[]> {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 6);
  if (tokens.length === 0) return [];
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM entity WHERE tenant_id = $tenantId LIMIT 200',
    { tenantId },
  );
  const scored = rows
    .map((r) => {
      const entity = mapEntity(r);
      const hay = `${entity.name} ${entity.description ?? ''}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (hay.includes(token.toLowerCase())) score += 1;
      }
      return { entity, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((s) => s.entity);
}

export async function getNeighborEntities(
  tenantId: string,
  entityIds: string[],
  limit = 12,
): Promise<EntityRow[]> {
  if (entityIds.length === 0) return [];
  const records = entityIds.map((id) => new RecordId('entity', id));
  const [outRows, inRows] = await Promise.all([
    queryRows<Record<string, unknown>>(
      getDb(),
      'SELECT * FROM relates WHERE tenant_id = $tenantId AND in IN $records',
      { tenantId, records },
    ),
    queryRows<Record<string, unknown>>(
      getDb(),
      'SELECT * FROM relates WHERE tenant_id = $tenantId AND out IN $records',
      { tenantId, records },
    ),
  ]);
  const ids = new Set<string>();
  for (const row of [...outRows, ...inRows]) {
    const mapped = mapRelates(row);
    const neighborId = entityIds.includes(mapped.fromEntityId)
      ? mapped.toEntityId
      : mapped.fromEntityId;
    if (neighborId && !entityIds.includes(neighborId)) ids.add(neighborId);
  }
  const neighbors: EntityRow[] = [];
  for (const id of [...ids].slice(0, limit)) {
    const row = await selectById<Record<string, unknown>>(getDb(), 'entity', id);
    if (row) neighbors.push(mapEntity(row));
  }
  return neighbors;
}

export async function getChunksForEntities(
  tenantId: string,
  entityIds: string[],
  limit = 8,
): Promise<ChunkRow[]> {
  if (entityIds.length === 0) return [];
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM chunk_entity WHERE tenant_id = $tenantId AND entity_id IN $entityIds LIMIT $limit',
    { tenantId, entityIds, limit: limit * 2 },
  );
  const chunkIds = [...new Set(rows.map((r) => String(r.chunk_id ?? '')).filter(Boolean))].slice(0, limit);
  const chunks: ChunkRow[] = [];
  for (const chunkId of chunkIds) {
    const row = await selectById<Record<string, unknown>>(getDb(), 'chunk', chunkId);
    if (row) chunks.push(mapChunk(row));
  }
  return chunks;
}

export async function getChunksForEntity(
  tenantId: string,
  entityId: string,
  limit = 6,
): Promise<ChunkRow[]> {
  return getChunksForEntities(tenantId, [entityId], limit);
}

export async function listGraphForTenant(
  tenantId: string,
  options?: { documentId?: string; limit?: number },
): Promise<{ entities: EntityRow[]; edges: RelatesRow[] }> {
  const limit = options?.limit ?? 200;
  const documentId = options?.documentId;
  const entityQuery = documentId
    ? 'SELECT * FROM entity WHERE tenant_id = $tenantId AND document_id = $documentId LIMIT $limit'
    : 'SELECT * FROM entity WHERE tenant_id = $tenantId LIMIT $limit';
  const edgeQuery = documentId
    ? 'SELECT * FROM relates WHERE tenant_id = $tenantId AND document_id = $documentId LIMIT $limit'
    : 'SELECT * FROM relates WHERE tenant_id = $tenantId LIMIT $limit';
  const params = documentId ? { tenantId, documentId, limit } : { tenantId, limit };
  const entities = (await queryRows<Record<string, unknown>>(getDb(), entityQuery, params)).map(mapEntity);
  const edges = (await queryRows<Record<string, unknown>>(getDb(), edgeQuery, params)).map(mapRelates);
  return { entities, edges };
}

export type { KnowledgeReference };

export async function hybridSearchChunks(
  tenantId: string,
  query: string,
  embedding: number[] | null,
  limit = 8,
): Promise<KnowledgeReference[]> {
  const candidateLimit = Math.max(limit * RRF_CANDIDATE_MULTIPLIER, 24);
  const [textHits, vecHits, seedEntities] = await Promise.all([
    searchChunksByText(tenantId, query, candidateLimit),
    embedding ? searchChunksByVector(tenantId, embedding, candidateLimit) : Promise.resolve([]),
    searchEntitiesByQuery(tenantId, query, 6),
  ]);

  const neighborEntities = await getNeighborEntities(
    tenantId,
    seedEntities.map((e) => e.id),
    8,
  );
  const graphEntityIds = [...seedEntities, ...neighborEntities].map((e) => e.id);
  const graphChunks = await getChunksForEntities(tenantId, graphEntityIds, candidateLimit);

  const textRefs = textHits.map((c, i) => chunkToReference(c, 1 - i * 0.05));
  const vecRefs = vecHits.map((hit, i) => chunkToReference(hit.chunk, hit.sim - i * 0.001));
  const graphRefs = graphChunks.map((c, i) => chunkToReference(c, 0.75 - i * 0.03));

  return withRefIndexes(reciprocalRankFusion([textRefs, vecRefs, graphRefs], candidateLimit));
}

export async function saveAgentCitation(row: {
  tenantId: string;
  threadId?: string | null;
  query: string;
  references: KnowledgeReference[];
}): Promise<AgentCitationRow> {
  const id = newId();
  await createRecord(getDb(), 'agent_citation', {
    id,
    tenant_id: row.tenantId,
    thread_id: row.threadId ?? null,
    query: row.query,
    references: row.references,
  });
  const saved = await selectById<Record<string, unknown>>(getDb(), 'agent_citation', id);
  return mapCitation(saved!);
}

export async function getLatestAgentCitation(
  tenantId: string,
  threadId?: string | null,
): Promise<AgentCitationRow | null> {
  const rows = threadId
    ? await queryRows<Record<string, unknown>>(
        getDb(),
        'SELECT * FROM agent_citation WHERE tenant_id = $tenantId AND thread_id = $threadId ORDER BY created_at DESC LIMIT 1',
        { tenantId, threadId },
      )
    : await queryRows<Record<string, unknown>>(
        getDb(),
        'SELECT * FROM agent_citation WHERE tenant_id = $tenantId ORDER BY created_at DESC LIMIT 1',
        { tenantId },
      );
  return rows[0] ? mapCitation(rows[0]) : null;
}

export const __test__ = { reciprocalRankFusion, withRefIndexes, normalizeEntityKey };
