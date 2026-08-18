import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appToolsCacheKey } from './app-tools-key';

describe('appToolsCacheKey', () => {
  it('钉定变了就是另一把键 —— 钉定前问到的空表不该盖住钉定后的结果', () => {
    assert.notEqual(appToolsCacheKey('t1', undefined), appToolsCacheKey('t1', 'p1'));
  });

  it('同线程同钉定,键稳定(不会每次渲染都重取)', () => {
    assert.equal(appToolsCacheKey('t1', 'p1'), appToolsCacheKey('t1', 'p1'));
  });

  it('不同线程互不串味', () => {
    assert.notEqual(appToolsCacheKey('t1', 'p1'), appToolsCacheKey('t2', 'p1'));
  });
});
