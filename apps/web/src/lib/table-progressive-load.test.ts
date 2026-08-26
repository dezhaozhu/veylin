import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TABLE_GRID_FILL_CHUNK,
  TABLE_GRID_FIRST_PAGE,
  shouldWaitForMoreRows,
  tableFillOffset,
} from './table-progressive-load';

describe('tableFillOffset', () => {
  it('第一页不够整表 → 从已加载条数接着拉', () => {
    assert.equal(tableFillOffset(TABLE_GRID_FIRST_PAGE, 30_923), TABLE_GRID_FIRST_PAGE);
  });

  it('第一页已经是全部 → 停', () => {
    assert.equal(tableFillOffset(12, 12), null);
    assert.equal(tableFillOffset(0, 0), null);
  });

  it('没说总数就当这一页是全部', () => {
    assert.equal(tableFillOffset(TABLE_GRID_FIRST_PAGE, undefined), null);
  });
});

describe('shouldWaitForMoreRows', () => {
  it('后面还有行 → 定位先等', () => {
    assert.equal(shouldWaitForMoreRows(TABLE_GRID_FIRST_PAGE, 30_923), true);
  });

  it('齐了,或根本不知道总数 → 不等', () => {
    assert.equal(shouldWaitForMoreRows(30_923, 30_923), false);
    assert.equal(shouldWaitForMoreRows(TABLE_GRID_FIRST_PAGE, null), false);
  });
});

describe('chunk size', () => {
  it('续灌比第一页大,但单次不会把整表再拉一遍', () => {
    assert.ok(TABLE_GRID_FILL_CHUNK > TABLE_GRID_FIRST_PAGE);
    assert.ok(TABLE_GRID_FILL_CHUNK < 30_000);
  });
});
