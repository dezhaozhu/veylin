/**
 * 空值不是 "null"。
 *
 * 上游 JSON 里的 `null` 表示"这件事还没发生"(三级里 7,900 多道工序没有实际开工
 * 时间)。落进网格时 String(null) 会写成字面量 "null" —— 屏幕上就长得像一个值,
 * 而且能被筛选、被排序、被 agent 当数据读走。空就得是空。
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTableSheet, importTableSheet, listTableRows, deleteTableSheet } from './table-store.js';

const SHEET = 'null-probe';

describe('导入时的空值', () => {
  beforeEach(async () => {
    await deleteTableSheet(SHEET).catch(() => {});
    createTableSheet(SHEET);
  });

  it('null 落成空串,不落成 "null"', () => {
    importTableSheet(
      SHEET,
      [],
      [{ op: '第四火', actual_start: null, actual_end: null } as never],
      undefined,
      [
        { key: 'op', name: '工序', type: 'text' },
        { key: 'actual_start', name: '实际开始', type: 'text' },
        { key: 'actual_end', name: '实际完成', type: 'text' },
      ],
    );
    const row = listTableRows(SHEET)[0]!;
    assert.equal(row['op'], '第四火');
    assert.equal(row['actual_start'], '', '未开工 = 空,不是字符串 "null"');
    assert.equal(row['actual_end'], '');
  });

  it('数值列与状态列的 null 同样是空', () => {
    importTableSheet(
      SHEET,
      [],
      [{ seq: null, status: null } as never],
      undefined,
      [
        { key: 'seq', name: '工序号', type: 'number' },
        { key: 'status', name: '状态', type: 'status', statusOptions: ['DONE'] },
      ],
    );
    const row = listTableRows(SHEET)[0]!;
    assert.equal(row['seq'], '');
    assert.equal(row['status'], '');
  });

  it('字符串 "null" 本身还是原样保留 —— 那可能真是个值', () => {
    importTableSheet(SHEET, [], [{ op: 'null' } as never], undefined,
      [{ key: 'op', name: '工序', type: 'text' }]);
    assert.equal(listTableRows(SHEET)[0]!['op'], 'null');
  });
});
