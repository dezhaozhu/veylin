/**
 * 「引用什么」的判定。
 *
 * 手势的语义:**框选一片**才是引用,**点一个格子**不是 —— 点格子多半是要改它。
 * 勾选整行就是整行(所有列),不该被那个刚点过的格子偷换成"1 行 1 列"。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSelectionScope } from './grid-selection-scope.js';

const noRange = { rowKeys: [], columns: [] };

describe('resolveSelectionScope', () => {
  it('框选一片 → 就是那一片(行 × 列)', () => {
    const out = resolveSelectionScope({
      range: { rowKeys: ['r1', 'r2'], columns: ['due_at'] },
      checkedRowKeys: [],
    });
    assert.deepEqual(out, { rowKeys: ['r1', 'r2'], columns: ['due_at'] });
  });

  it('只点了一个格子 → 不算引用(用户多半是要编辑它)', () => {
    const out = resolveSelectionScope({
      range: { rowKeys: ['r1'], columns: ['order_id'] },
      checkedRowKeys: [],
    });
    assert.equal(out, null);
  });

  it('勾了 4 行、又点过一个格子 → 引用的是那 4 行的**整行**', () => {
    // 截图里的 bug:1×1 的格子区域抢在勾选行前面,4 行变成了「1 行 · 列 order_id」
    const out = resolveSelectionScope({
      range: { rowKeys: ['r4'], columns: ['order_id'] },
      checkedRowKeys: ['r4', 'r5', 'r6', 'r7'],
    });
    assert.deepEqual(out, { rowKeys: ['r4', 'r5', 'r6', 'r7'], columns: [] });
  });

  it('同一行框了两列 → 是片,算', () => {
    const out = resolveSelectionScope({
      range: { rowKeys: ['r1'], columns: ['due_at', 'end'] },
      checkedRowKeys: [],
    });
    assert.deepEqual(out, { rowKeys: ['r1'], columns: ['due_at', 'end'] });
  });

  it('点了列头(整列)→ 引用整列', () => {
    const out = resolveSelectionScope({
      range: noRange, checkedRowKeys: [], selectedColumnKey: 'workshop',
    });
    assert.deepEqual(out, { rowKeys: [], columns: ['workshop'] });
  });

  it('什么都没选 → null(按钮不该冒出来)', () => {
    assert.equal(resolveSelectionScope({ range: noRange, checkedRowKeys: [] }), null);
  });

  it('勾选行优先于整列选择 —— 行是更具体的那个', () => {
    const out = resolveSelectionScope({
      range: noRange, checkedRowKeys: ['r1'], selectedColumnKey: 'workshop',
    });
    assert.deepEqual(out, { rowKeys: ['r1'], columns: [] });
  });
});
