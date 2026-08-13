import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendSelectionToken } from './table-selection-ref.js';

describe('appendSelectionToken', () => {
  it('不覆盖用户已经写下的字', () => {
    assert.equal(
      appendSelectionToken('为什么这批迟', '@表格[x #ab]'),
      '为什么这批迟\n\n@表格[x #ab] ',
    );
  });

  it('空输入框时直接放引用,并留一个空格好接着打字', () => {
    assert.equal(appendSelectionToken('   ', '@表格[x #ab]'), '@表格[x #ab] ');
  });
});
