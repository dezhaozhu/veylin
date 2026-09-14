import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tableFooterHint } from './table-footer-hint.js';

describe('tableFooterHint', () => {
  it('还在灌数时只报加载进度，不报合计', () => {
    assert.deepEqual(
      tableFooterHint({ selectedCount: 2, loadedCount: 500, expectedCount: 7219 }),
      { kind: 'loading', loaded: 500, total: 7219 },
    );
  });

  it('装齐后有勾选才显示已选', () => {
    assert.deepEqual(
      tableFooterHint({ selectedCount: 2, loadedCount: 7219, expectedCount: 7219 }),
      { kind: 'selected', count: 2 },
    );
  });

  it('装齐且没勾选就不占一行 —— 总数交给翻页', () => {
    assert.equal(
      tableFooterHint({ selectedCount: 0, loadedCount: 7219, expectedCount: 7219 }).kind,
      'none',
    );
  });
});
