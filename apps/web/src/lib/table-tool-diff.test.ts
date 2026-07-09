import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isBlankCellValue,
  isTableMutatingTool,
  sumTableToolDiffs,
  tableToolDiff,
} from './table-tool-diff.ts';

describe('table-tool-diff', () => {
  it('identifies mutating table tools', () => {
    assert.equal(isTableMutatingTool('table_set_cell'), true);
    assert.equal(isTableMutatingTool('table_get'), false);
    assert.equal(isTableMutatingTool('table_list_sheets'), false);
  });

  it('treats empty string as blank', () => {
    assert.equal(isBlankCellValue(''), true);
    assert.equal(isBlankCellValue('  '), true);
    assert.equal(isBlankCellValue('x'), false);
    assert.equal(isBlankCellValue(0), false);
  });

  it('counts blank → value as +1 only', () => {
    assert.deepEqual(
      tableToolDiff(
        'table_set_cell',
        { column: 'a', value: 'x' },
        { ok: true, applied: { a: 'x' }, previous: { a: '' } },
      ),
      { added: 1, removed: 0 },
    );
  });

  it('counts value → blank as -1 only', () => {
    assert.deepEqual(
      tableToolDiff(
        'table_set_cell',
        { column: 'a', value: '' },
        { ok: true, applied: { a: '' }, previous: { a: 'old' } },
      ),
      { added: 0, removed: 1 },
    );
  });

  it('counts value → value as +1 -1', () => {
    assert.deepEqual(
      tableToolDiff(
        'table_set_cell',
        { column: 'a', value: 'x' },
        { ok: true, applied: { a: 'x' }, previous: { a: 'old' } },
      ),
      { added: 1, removed: 1 },
    );
  });

  it('ignores failed or missing results', () => {
    assert.deepEqual(
      tableToolDiff('table_set_cell', { column: 'a', value: 'x' }, { ok: false }),
      { added: 0, removed: 0 },
    );
    assert.deepEqual(
      tableToolDiff('table_set_cell', { column: 'a', value: 'x' }, undefined),
      { added: 0, removed: 0 },
    );
  });

  it('counts update_row fields by blank/non-blank transitions', () => {
    assert.deepEqual(
      tableToolDiff(
        'table_update_row',
        { values: { a: 1, b: '', c: 3 } },
        {
          ok: true,
          applied: { a: 1, b: '', c: 3 },
          previous: { a: '', b: 'keep', c: 2 },
        },
      ),
      // a: blank→value +1; b: value→blank -1; c: value→value +1 -1
      { added: 2, removed: 2 },
    );
  });

  it('falls back to blank previous when applied/previous are missing', () => {
    assert.deepEqual(
      tableToolDiff('table_set_cell', { column: 'a', value: 'x' }, { ok: true }),
      { added: 1, removed: 0 },
    );
  });

  it('counts delete_rows from result.removed', () => {
    assert.deepEqual(
      tableToolDiff(
        'table_delete_rows',
        { row_keys: ['1', '2', '3'] },
        { ok: true, removed: 2 },
      ),
      { added: 0, removed: 2 },
    );
  });

  it('falls back to row_keys length when removed is missing', () => {
    assert.deepEqual(
      tableToolDiff(
        'table_delete_rows',
        { row_keys: ['1', '2'] },
        { ok: true },
      ),
      { added: 0, removed: 2 },
    );
  });

  it('sums diffs across a tool group', () => {
    assert.deepEqual(
      sumTableToolDiffs([
        {
          toolName: 'table_set_cell',
          args: { column: 'a', value: 'x' },
          result: { ok: true, applied: { a: 'x' }, previous: { a: '' } },
        },
        {
          toolName: 'table_set_cell',
          args: { column: 'b', value: 'y' },
          result: { ok: true, applied: { b: 'y' }, previous: { b: 'old' } },
        },
        { toolName: 'table_add_row', args: {}, result: { ok: true } },
        { toolName: 'table_get', args: {}, result: { ok: true } },
      ]),
      // blank→x +1; old→y +1 -1; add_row +1
      { added: 3, removed: 1 },
    );
  });
});
