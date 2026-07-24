/**
 * Sheet-source (load provenance) round-trips through the real embedded SurrealDB —
 * same pattern as mcp-store.group.test.ts. Exercises the packages/db layer
 * (init-schema `source` field + table-repos upsert/list) that table-store.ts's
 * in-memory-only tests (table-tools-provenance.test.ts) don't touch.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  closeDb,
  connectDb,
  listTableSheets as listTableSheetsDb,
  upsertTableSheet,
} from '@veylin/db';
import { createTableSheet, stampTableSheetSource } from './table-store.js';

describe('table sheet source (load provenance) — real DB round-trip', () => {
  before(async () => {
    await connectDb();
  });

  after(async () => {
    await closeDb();
  });

  it('persists a stamped source and reads it back verbatim', async () => {
    const created = createTableSheet(`prov-db-${Date.now()}`);
    assert.ok(created);

    const source = {
      server: 'compass-guolu',
      tenant: 'guolu',
      loadedAt: '2026-07-20T03:04:05.000Z',
    };
    const stamped = await stampTableSheetSource(created!.id, source);
    assert.deepEqual(stamped?.source, source);

    const rows = await listTableSheetsDb();
    const row = rows.find((r) => r.id === created!.id);
    assert.ok(row, 'sheet row should exist in the real DB');
    assert.deepEqual(row!.source, source);
  });

  it('a sheet that is never stamped has no source in the real DB (legacy shape)', async () => {
    // Write directly via the db-layer repo (bypassing table-store's fire-and-forget
    // tablePersist) so the assertion below doesn't race an unawaited write.
    const id = `prov-db-legacy-${Date.now()}`;
    await upsertTableSheet({ id, name: id, builtin: false, threadId: null });

    const rows = await listTableSheetsDb();
    const row = rows.find((r) => r.id === id);
    assert.ok(row);
    assert.ok(row!.source === null || row!.source === undefined);
  });

  it('re-stamping overwrites the previous source (not merged)', async () => {
    const created = createTableSheet(`prov-db-restamp-${Date.now()}`);
    assert.ok(created);

    await stampTableSheetSource(created!.id, {
      server: 'compass-shangzhong',
      tenant: 'shangzhong',
      loadedAt: '2026-07-19T00:00:00.000Z',
    });
    const second = {
      server: 'compass-guolu',
      tenant: 'guolu',
      loadedAt: '2026-07-21T00:00:00.000Z',
    };
    await stampTableSheetSource(created!.id, second);

    const rows = await listTableSheetsDb();
    const row = rows.find((r) => r.id === created!.id);
    assert.deepEqual(row!.source, second);
  });
});
