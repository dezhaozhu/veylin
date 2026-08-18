import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { columnToReveal, newColumnKeys } from './new-columns';

describe('newColumnKeys', () => {
  it('认出多出来的列', () => {
    assert.deepEqual(newColumnKeys(['a', 'b'], ['a', 'b', 'c']), ['c']);
  });

  it('顺序变了不算新列 —— 拖动列序不该把人甩走', () => {
    assert.deepEqual(newColumnKeys(['a', 'b'], ['b', 'a']), []);
  });

  it('删列不算', () => {
    assert.deepEqual(newColumnKeys(['a', 'b'], ['a']), []);
  });
});

describe('columnToReveal', () => {
  it('**加了一列就带过去** —— 这正是"加了却看不见"那个问题', () => {
    assert.equal(columnToReveal(['型号', '单价'], ['型号', '单价', '均价']), '均价');
  });

  it('**首屏不带** —— 第一次拿到列时每一列都是新的,滚过去只会把视线甩到最右边', () => {
    assert.equal(columnToReveal([], ['a', 'b', 'c']), null);
  });

  it('一次加好几列,带到最后一列(前面几列顺带进视野)', () => {
    assert.equal(columnToReveal(['a'], ['a', 'b', 'c']), 'c');
  });

  it('没加列就不动', () => {
    assert.equal(columnToReveal(['a', 'b'], ['a', 'b']), null);
  });
});
