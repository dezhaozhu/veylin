import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UiMessage } from '@veylin/shared';
import {
  addTableColumn,
  addTableRow,
  deleteTableRows,
  importTableSheet,
  listTableRows,
  restoreDeletedTableRows,
  updateTableRow,
} from './table-store.js';
import {
  collectTableCellMutations,
  removedMessagesAfterPrefix,
  undoTableCellMutationsFromRemovedMessages,
} from './table-transcript-restore.js';

describe('deleteTableRows snapshots', () => {
  it('returns removed rows with original indices', () => {
    importTableSheet('main', ['name'], [
      { name: 'a' },
      { name: 'b' },
      { name: 'c' },
    ]);
    const before = listTableRows('main');
    assert.equal(before.length, 3);

    const { removed, rows } = deleteTableRows('main', [
      before[0]!.row_id,
      before[2]!.row_id,
    ]);
    assert.equal(removed, 2);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.index, 0);
    assert.equal(rows[0]!.row.name, 'a');
    assert.equal(rows[1]!.index, 2);
    assert.equal(rows[1]!.row.name, 'c');
    assert.deepEqual(
      listTableRows('main').map((r) => r.name),
      ['b'],
    );
  });

  it('restoreDeletedTableRows puts rows back at recorded indices', () => {
    importTableSheet('main', ['name'], [
      { name: 'a' },
      { name: 'b' },
      { name: 'c' },
    ]);
    const before = listTableRows('main');
    const { rows } = deleteTableRows('main', [before[1]!.row_id]);
    assert.equal(listTableRows('main').length, 2);

    const restored = restoreDeletedTableRows('main', rows);
    assert.equal(restored, 1);
    assert.deepEqual(
      listTableRows('main').map((r) => r.name),
      ['a', 'b', 'c'],
    );
  });
});

describe('collectTableCellMutations', () => {
  it('collects successful cell mutations in order', () => {
    const messages: UiMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-table_set_cell',
            toolName: 'table_set_cell',
            input: { row_key: 'r1', column: 'name', value: 'x' },
            output: {
              ok: true,
              sheet: 'main',
              row: { row_id: 'r1', name: 'x' },
              applied: { name: 'x' },
              previous: { name: '' },
            },
          },
          {
            type: 'tool-table_add_row',
            toolName: 'table_add_row',
            output: { ok: true, sheet: 'main', row: { row_id: 'r2' } },
          },
          {
            type: 'tool-table_add_column',
            toolName: 'table_add_column',
            output: { ok: true, sheet: 'main', column: { key: 'c', name: 'C' } },
          },
          {
            type: 'tool-table_update_cells',
            toolName: 'table_update_cells',
            input: {
              updates: [{ row_key: 'r1', column: 'name', value: 'y' }],
            },
            output: {
              ok: true,
              sheet: 'main',
              updated: 1,
              cells: [{ row_key: 'r1', column: 'name', value: 'y', previous: 'x' }],
            },
          },
        ],
      },
    ];

    const mutations = collectTableCellMutations(messages);
    assert.equal(mutations.length, 3);
    assert.equal(mutations[0]!.toolName, 'table_set_cell');
    assert.equal(mutations[1]!.toolName, 'table_add_row');
    assert.equal(mutations[2]!.toolName, 'table_update_cells');
  });

  it('skips failed results and legacy delete_rows without snapshots', () => {
    const messages: UiMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-table_set_cell',
            output: { ok: false, previous: { name: 'old' } },
          },
          {
            type: 'tool-table_delete_rows',
            output: { ok: true, sheet: 'main', removed: 1 },
          },
        ],
      },
    ];
    assert.equal(collectTableCellMutations(messages).length, 0);
  });
});

describe('removedMessagesAfterPrefix', () => {
  it('returns the truncated suffix by shared message ids', () => {
    const stored: UiMessage[] = [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
      { id: 'u2', role: 'user' },
      { id: 'a2', role: 'assistant' },
    ];
    const client: UiMessage[] = [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
    ];
    const removed = removedMessagesAfterPrefix(stored, client);
    assert.deepEqual(
      removed.map((m) => m.id),
      ['u2', 'a2'],
    );
  });
});

describe('undoTableCellMutationsFromRemovedMessages', () => {
  it('restores set_cell / update_row / add_row / delete_rows after truncate', async () => {
    importTableSheet('main', ['name', 'qty'], [{ name: 'keep', qty: 1 }]);
    addTableColumn('main', 'extra');

    const base = listTableRows('main')[0]!;
    const setResult = await updateTableRow(
      base.row_id,
      { name: 'changed' },
      'main',
    );
    assert.equal(setResult.ok, true);

    const updateResult = await updateTableRow(
      base.row_id,
      { qty: 99 },
      'main',
    );
    assert.equal(updateResult.ok, true);

    const added = addTableRow('main')!;
    await updateTableRow(added.row_id, { name: 'new' }, 'main');

    const mid = addTableRow('main')!;
    await updateTableRow(mid.row_id, { name: 'mid' }, 'main');
    const deleted = deleteTableRows('main', [mid.row_id]);
    assert.equal(deleted.removed, 1);

    const removedMessages: UiMessage[] = [
      {
        id: 'a-removed',
        role: 'assistant',
        parts: [
          {
            type: 'tool-table_set_cell',
            toolName: 'table_set_cell',
            input: { row_key: base.row_id, column: 'name', value: 'changed' },
            output: {
              ok: true,
              sheet: 'main',
              row: setResult.row,
              applied: setResult.applied,
              previous: setResult.previous,
            },
          },
          {
            type: 'tool-table_update_row',
            toolName: 'table_update_row',
            input: { row_key: base.row_id, values: { qty: 99 } },
            output: {
              ok: true,
              sheet: 'main',
              row: updateResult.row,
              applied: updateResult.applied,
              previous: updateResult.previous,
            },
          },
          {
            type: 'tool-table_add_row',
            toolName: 'table_add_row',
            output: { ok: true, sheet: 'main', row: added },
          },
          {
            type: 'tool-table_set_cell',
            toolName: 'table_set_cell',
            input: { row_key: added.row_id, column: 'name', value: 'new' },
            output: {
              ok: true,
              sheet: 'main',
              applied: { name: 'new' },
              previous: { name: '' },
              row: { row_id: added.row_id, name: 'new' },
            },
          },
          {
            type: 'tool-table_add_row',
            toolName: 'table_add_row',
            output: { ok: true, sheet: 'main', row: mid },
          },
          {
            type: 'tool-table_delete_rows',
            toolName: 'table_delete_rows',
            input: { row_keys: [mid.row_id] },
            output: {
              ok: true,
              sheet: 'main',
              removed: deleted.removed,
              rows: deleted.rows,
            },
          },
        ],
      },
    ];

    // Current state after mutations: base changed + added row (mid deleted).
    assert.equal(listTableRows('main').find((r) => r.row_id === base.row_id)?.name, 'changed');
    assert.equal(String(listTableRows('main').find((r) => r.row_id === base.row_id)?.qty), '99');
    assert.ok(listTableRows('main').some((r) => r.row_id === added.row_id));
    assert.ok(!listTableRows('main').some((r) => r.row_id === mid.row_id));

    const undone = await undoTableCellMutationsFromRemovedMessages(removedMessages);
    assert.ok(undone >= 4);

    const after = listTableRows('main');
    const restoredBase = after.find((r) => r.row_id === base.row_id);
    assert.ok(restoredBase);
    assert.equal(restoredBase.name, 'keep');
    assert.equal(String(restoredBase.qty), '1');
    assert.ok(!after.some((r) => r.row_id === added.row_id));
    // mid was added then deleted in the removed suffix; undoing delete then add
    // leaves mid absent (net zero), matching pre-suffix state.
    assert.ok(!after.some((r) => r.row_id === mid.row_id));
  });
});
