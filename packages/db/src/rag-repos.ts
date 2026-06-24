import { RecordId } from 'surrealdb';
import { getDb } from './client';
import { newId, normalizeId, queryRows, createRecord, selectById } from './query';
import type { ChunkRow, DocumentRow, EntityRow, RelatesRow } from './types';

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

function mapEntity(r: Record<string, unknown>): EntityRow {
  return {
    id: normalizeId(r.id),
    tenantId: String(r.tenant_id ?? ''),
    name: String(r.name ?? ''),
    type: String(r.type ?? 'concept'),
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
): Promise<ChunkRow[]> {
  // Fallback: brute-force cosine when HNSW index not configured
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM chunk WHERE tenant_id = $tenantId AND embedding != NONE',
    { tenantId },
  );
  const scored = rows
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
      return { row: r, sim };
    })
    .filter((x): x is { row: Record<string, unknown>; sim: number } => x != null)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit);
  return scored.map((s) => mapChunk(s.row));
}

export async function insertEntity(row: Omit<EntityRow, 'id'> & { id?: string }): Promise<EntityRow> {
  const id = row.id ?? newId();
  await createRecord(getDb(), 'entity', {
    id,
    tenant_id: row.tenantId,
    name: row.name,
    type: row.type,
    document_id: row.documentId ?? null,
  });
  return mapEntity((await selectById<Record<string, unknown>>(getDb(), 'entity', id))!);
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

export async function listGraphForTenant(
  tenantId: string,
  limit = 200,
): Promise<{ entities: EntityRow[]; edges: RelatesRow[] }> {
  const entities = (
    await queryRows<Record<string, unknown>>(
      getDb(),
      'SELECT * FROM entity WHERE tenant_id = $tenantId LIMIT $limit',
      { tenantId, limit },
    )
  ).map(mapEntity);
  const edges = (
    await queryRows<Record<string, unknown>>(
      getDb(),
      'SELECT * FROM relates WHERE tenant_id = $tenantId LIMIT $limit',
      { tenantId, limit },
    )
  ).map(mapRelates);
  return { entities, edges };
}

export type KnowledgeReference = {
  chunkId: string;
  documentId: string;
  source: string;
  text: string;
  offset: number;
  score?: number;
};

export async function hybridSearchChunks(
  tenantId: string,
  query: string,
  embedding: number[] | null,
  limit = 8,
): Promise<KnowledgeReference[]> {
  const [textHits, vecHits] = await Promise.all([
    searchChunksByText(tenantId, query, limit),
    embedding ? searchChunksByVector(tenantId, embedding, limit) : Promise.resolve([]),
  ]);
  const merged = new Map<string, KnowledgeReference>();
  for (const c of textHits) {
    merged.set(c.id, {
      chunkId: c.id,
      documentId: c.documentId,
      source: c.source,
      text: c.text,
      offset: c.offset,
      score: 0.5,
    });
  }
  for (const c of vecHits) {
    const prev = merged.get(c.id);
    merged.set(c.id, {
      chunkId: c.id,
      documentId: c.documentId,
      source: c.source,
      text: c.text,
      offset: c.offset,
      score: (prev?.score ?? 0) + 1,
    });
  }
  return [...merged.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
}
