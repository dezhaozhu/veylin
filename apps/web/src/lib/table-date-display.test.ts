import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatTableDateDisplay } from './table-date-display.js';

describe('formatTableDateDisplay', () => {
  it('ISO 日期时间只留年月日 —— 午夜后缀对人没有信息', () => {
    assert.equal(formatTableDateDisplay('2013-03-06T00:00:00'), '2013-03-06');
    assert.equal(formatTableDateDisplay('2013-05-20T00:00:00'), '2013-05-20');
    assert.equal(formatTableDateDisplay('2012-07-22T00:00:00Z'), '2012-07-22');
  });

  it('本来就是日期的保持原样', () => {
    assert.equal(formatTableDateDisplay('2013-03-06'), '2013-03-06');
  });

  it('空值和普通文本不动', () => {
    assert.equal(formatTableDateDisplay(null), '');
    assert.equal(formatTableDateDisplay(undefined), '');
    assert.equal(formatTableDateDisplay(''), '');
    assert.equal(formatTableDateDisplay('COMPLETE'), 'COMPLETE');
    assert.equal(formatTableDateDisplay(12), '12');
  });
});
