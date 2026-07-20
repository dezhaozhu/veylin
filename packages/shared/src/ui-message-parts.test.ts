import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isInternalModelContinuationText,
  sanitizeDisplayTextPart,
  sanitizeUiMessagePartsForDisplay,
  stripInternalModelContinuationText,
  stripWorkingMemoryEchoText,
} from './ui-message-parts.js';

describe('ui-message-parts', () => {
  it('detects ask_user_question continuation-only text', () => {
    const internal =
      'User has answered your questions: "Q"="A". You can now continue with the user\'s answers in mind.';
    assert.equal(isInternalModelContinuationText(internal), true);
    assert.equal(sanitizeDisplayTextPart(internal), null);
  });

  it('keeps assistant prose when mixed with continuation text', () => {
    const mixed =
      '好的，那我们来聊聊研究相关的事情。\nUser has answered your questions: "Q"="A". You can now continue with the user\'s answers in mind.';
    assert.equal(isInternalModelContinuationText(mixed), false);
    assert.equal(
      stripInternalModelContinuationText(mixed),
      '好的，那我们来聊聊研究相关的事情。',
    );
  });

  it('sanitizes text parts but keeps tool parts', () => {
    const parts = sanitizeUiMessagePartsForDisplay([
      {
        type: 'text',
        text: 'User has answered your questions: "Q"="A". You can now continue with the user\'s answers in mind.',
      },
      {
        type: 'tool-ask_user_question',
        state: 'output-available',
        output: { answers: { Q: 'A' } },
      },
      { type: 'text', text: '可见的助手回复' },
    ]);
    assert.equal(parts.length, 2);
    assert.equal(parts[0]?.type, 'tool-ask_user_question');
    assert.equal((parts[1] as { text?: string }).text, '可见的助手回复');
  });

  it('strips trailing working_memory_data echo from assistant prose', () => {
    const mixed =
      '下一步您是希望针对某类特定物料追踪火次流转，还是分析积压优先级？\n\n' +
      '<working_memory_data>\n' +
      '用户角色：生产排程数据分析者\n' +
      '用户目标：深入分析单工位排程负载（方向1）\n' +
      '当前焦点：165MN油压机排程时间线分析\n' +
      '</working_memory_data>';
    assert.equal(
      sanitizeDisplayTextPart(mixed),
      '下一步您是希望针对某类特定物料追踪火次流转，还是分析积压优先级？',
    );
  });

  it('drops text that is only a working_memory_data block', () => {
    const onlyWm =
      '<working_memory_data>\n用户角色：生产排程数据分析者\n</working_memory_data>';
    assert.equal(stripWorkingMemoryEchoText(onlyWm), '');
    assert.equal(sanitizeDisplayTextPart(onlyWm), null);
  });
});
