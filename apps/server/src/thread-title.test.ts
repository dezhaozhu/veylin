import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  firstUserText,
  isUnusableTitle,
  sanitizeGeneratedTitle,
  shouldSummarizeUserMessage,
  stripReasoningMarkup,
  titleFromUserMessage,
  truncateTitle,
} from './thread-title.js';

describe('thread-title', () => {
  it('reads first user text from legacy content string', () => {
    assert.equal(
      firstUserText([{ role: 'user', content: '  排产瓶颈有哪些？  ' }]),
      '排产瓶颈有哪些？',
    );
  });

  it('reads first user text from parts array', () => {
    assert.equal(
      firstUserText([
        { role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
        { role: 'user', parts: [{ type: 'text', text: '继续分析' }] },
      ]),
      '继续分析',
    );
  });

  it('truncates long titles', () => {
    const title = truncateTitle('a'.repeat(80), 20);
    assert.equal(title.length, 20);
    assert.equal(title.endsWith('...'), true);
  });

  it('keeps a short first user line as the title', () => {
    assert.equal(titleFromUserMessage('查数据'), '查数据');
    assert.equal(titleFromUserMessage('计划排产'), '计划排产');
    assert.equal(shouldSummarizeUserMessage('查数据'), false);
    assert.equal(shouldSummarizeUserMessage('计划排产'), false);
  });

  it('summarizes only long or multi-line pastes', () => {
    assert.equal(shouldSummarizeUserMessage('帮我看一下逾期订单'), false);
    assert.equal(
      shouldSummarizeUserMessage('这是一段很长的用户粘贴，用来说明侧栏标题不该整句留下。'.repeat(2)),
      true,
    );
  });

  it('strips think dumps and falls back to the user line', () => {
    const raw =
      '<think> The user message is "查数据" which is Chinese for check data.';
    assert.equal(stripReasoningMarkup(raw), '');
    assert.equal(isUnusableTitle(raw), true);
    assert.equal(sanitizeGeneratedTitle(raw, '查数据'), '查数据');
  });

  it('rejects meta titles that restate the user message', () => {
    assert.equal(
      sanitizeGeneratedTitle('The user asked about scheduling', '计划排产'),
      '计划排产',
    );
  });

  it('accepts a clean model phrase', () => {
    assert.equal(sanitizeGeneratedTitle('逾期订单核对', '很长的原文……'), '逾期订单核对');
  });
});
