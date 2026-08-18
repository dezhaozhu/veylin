import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isStaleSheetError } from './stale-sheet-recovery';

describe('isStaleSheetError', () => {
  it('**认得出"这张表不在本作用域"** —— 该退回默认表,不是报红', () => {
    assert.equal(isStaleSheetError('sheet not found'), true);
    assert.equal(isStaleSheetError('HTTP 404: sheet not found'), true);
  });

  it('**真故障照旧报红** —— 别把网络断了也吞成"换一张表"', () => {
    assert.equal(isStaleSheetError('Failed to fetch'), false);
    assert.equal(isStaleSheetError('HTTP 500'), false);
  });
});
