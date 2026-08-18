import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyQuotePrefixToMessage,
  formatSelectionAskComposerText,
  previewQuotedText,
  splitQuotedPrefix,
} from './thread-selection-ask';

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

  it('splits a sent quote prefix from the typed question', () => {
    assert.deepEqual(splitQuotedPrefix('> 甘特图 (get_gantt)\n\n这是什么'), {
      quote: '甘特图 (get_gantt)',
      body: '这是什么',
    });
    assert.deepEqual(splitQuotedPrefix('普通问题'), {
      quote: null,
      body: '普通问题',
    });
  });

  it('previews long quotes on one line', () => {
    assert.equal(previewQuotedText('甘特图 (get_gantt)'), '甘特图 (get_gantt)');
    assert.equal(previewQuotedText('abc', 2), 'ab…');
  });

  it('prefixes an outgoing text part with the quote', () => {
    const next = applyQuotePrefixToMessage(
      { parts: [{ type: 'text', text: '这是什么' }] },
      '甘特图 (get_gantt)',
    );
    assert.deepEqual(next.parts, [
      { type: 'text', text: '> 甘特图 (get_gantt)\n\n这是什么' },
    ]);
  });

  it('sends the quoted text itself when there is no extra question', () => {
    assert.deepEqual(
      applyQuotePrefixToMessage({ parts: [{ type: 'text', text: '' }] }, '看下迟到订单清单？').parts,
      [{ type: 'text', text: '看下迟到订单清单？' }],
    );
    assert.deepEqual(
      applyQuotePrefixToMessage(
        { parts: [{ type: 'text', text: '看下迟到订单清单？' }] },
        '看下迟到订单清单？',
      ).parts,
      [{ type: 'text', text: '看下迟到订单清单？' }],
    );
  });
});
