import type { Surreal } from 'surrealdb';
import { randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

/**
 * Coerce a value bound for a SurrealDB `datetime` column into a JS `Date`.
 * The SDK's CBOR encoder serializes `Date` as a native datetime; a plain ISO
 * string is rejected by SCHEMAFULL `datetime` fields. Callers persist ISO
 * strings for convenience, so normalize them here.
 */
export function toDbDatetime(value: unknown): Date | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value;
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function rid(table: string, id: string): string {
  return `${table}:${id}`;
}

function recordContent(data: Record<string, unknown> & { id?: string }): Record<string, unknown> {
  const { id: _id, ...content } = data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(content)) {
    // SurrealDB option<T> fields reject JSON null; omit unset values instead.
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

/** SurrealDB v1 embedded engine is most reliable when records are addressed explicitly. */
export async function createRecord(
  db: Surreal,
  table: string,
  data: Record<string, unknown> & { id?: string },
): Promise<void> {
  const id = data.id ?? newId();
  await db.query('CREATE type::thing($table, $id) CONTENT $content', {
    table,
    id,
    content: recordContent(data),
  });
}

/** First statement result rows from a SurrealQL query (v1 SDK). */
export async function queryRows<T>(
  db: Surreal,
  sql: string,
  vars?: Record<string, unknown>,
): Promise<T[]> {
  const result = await db.query(sql, vars);
  return (result?.[0] ?? []) as T[];
}

export function unwrapRecord<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row } as T & { id?: unknown };
  if (copy.id && typeof copy.id === 'object' && copy.id !== null && 'id' in (copy.id as object)) {
    const rec = copy.id as { tb?: string; id?: string };
    if (rec.tb && rec.id != null) {
      copy.id = `${rec.tb}:${rec.id}` as T['id'];
    }
  }
  return copy;
}

export function normalizeId(id: unknown): string {
  if (typeof id === 'string') {
    // Surreal complex record: table:⟨id:with:colons⟩
    const bracketed = id.match(/^[^:]+:⟨(.+)⟩$/);
    if (bracketed?.[1]) return bracketed[1];
    if (id.startsWith('⟨') && id.endsWith('⟩')) return id.slice(1, -1);
    // table:simpleId — only strip when the id part itself has no colons
    const simple = id.match(/^([A-Za-z_][A-Za-z0-9_]*):([^:]+)$/);
    if (simple?.[2]) return simple[2];
    // Already-logical ids may contain colons (e.g. plugin:tenant:name)
    return id;
  }
  if (id && typeof id === 'object' && 'id' in id) {
    const inner = (id as { id?: unknown }).id;
    if (inner == null) return String(id);
    // RecordId.id is already the thing key (may contain colons); do not re-split.
    if (typeof inner === 'string') {
      return inner.startsWith('⟨') && inner.endsWith('⟩') ? inner.slice(1, -1) : inner;
    }
    return normalizeId(inner);
  }
  return String(id);
}

export async function selectById<T>(
  db: Surreal,
  table: string,
  id: string,
): Promise<T | null> {
  const rows = await queryRows<T>(db, 'SELECT * FROM type::thing($table, $id) LIMIT 1', {
    table,
    id,
  });
  return rows[0] ?? null;
}

export async function deleteById(db: Surreal, table: string, id: string): Promise<void> {
  await db.query('DELETE type::thing($table, $id)', { table, id });
}

/** Create or update a SCHEMAFULL row keyed by string `id` field. */
export async function upsertById(
  db: Surreal,
  table: string,
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const existing = await selectById<Record<string, unknown>>(db, table, id);
  const content = recordContent({ id, ...fields });
  if (existing) {
    await db.query('UPDATE type::thing($table, $id) MERGE $content', {
      table,
      id,
      content,
    });
    return;
  }
  await createRecord(db, table, { id, ...fields });
}
