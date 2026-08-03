import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatSelectionAskComposerText } from './thread-selection-ask';

describe('thread-selection-ask', () => {
  it('formats selected text as markdown quote for the composer', () => {
    assert.equal(
      formatSelectionAskComposerText('建议是提高并行产能'),
      '> 建议是提高并行产能\n\n',
    );
  });

  it('preserves multiline selections as quoted lines', () => {
    assert.equal(
      formatSelectionAskComposerText('第一行\n第二行'),
      '> 第一行\n> 第二行\n\n',
    );
  });
});
