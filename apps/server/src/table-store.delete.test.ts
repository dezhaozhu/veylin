import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { connectDb, closeDb } from '@veylin/db';
import {
  initTableStore,
  deleteTableSheet,
  listTableSheets,
  addTableRow,
  listTableRows,
  createTableSheet,
} from './table-store.js';

describe('deleteTableSheet', () => {
  it('deletes main sheet with rows when other sheets exist', async () => {
    await connectDb();
    try {
      await initTableStore();
      createTableSheet(`backup-${Date.now()}`);
      for (let i = 0; i < 5; i++) addTableRow('main');
      assert.equal(listTableRows('main').length, 5);

      const ok = await deleteTableSheet('main');
      assert.equal(ok, true);
      assert.ok(!listTableSheets().some((s) => s.id === 'main'));
      assert.ok(listTableSheets().length >= 1);
    } finally {
      await closeDb();
    }
  });
});
