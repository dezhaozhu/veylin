import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dedupeAssistantMessageParts } from './assistant-display-parts.js';

describe('dedupeAssistantMessageParts', () => {
  it('removes repeated narration after an answered ask_user_question step', () => {
    const intro = '好的！我来帮你创建一个写故事的 skill。在动手之前，让我先了解一下你的具体需求。';
    const questions = '先聊聊你的想法。我有一些问题需要确认：';
    const tool = {
      type: 'tool-ask_user_question',
      state: 'output-available',
      output: { answers: { Q: 'A' } },
    };

    const parts = dedupeAssistantMessageParts([
      { type: 'reasoning', text: intro },
      { type: 'text', text: questions },
      tool,
      { type: 'step-start' },
      { type: 'reasoning', text: intro },
      { type: 'text', text: questions },
      {
        type: 'tool-ask_user_question',
        state: 'output-available',
        output: { answers: { Q2: 'B' } },
      },
      { type: 'step-start' },
      { type: 'reasoning', text: '好的，清楚了！你想创作中文长篇小说。' },
    ]);

    assert.equal(parts.filter((p) => (p as { type?: string }).type === 'reasoning').length, 2);
    assert.equal(
      parts.filter((p) => (p as { type?: string }).type === 'tool-ask_user_question').length,
      2,
    );
    assert.ok(!parts.some((p, i, arr) => {
      if ((p as { type?: string }).type !== 'reasoning') return false;
      return arr
        .slice(i + 1)
        .some(
          (later) =>
            (later as { type?: string }).type === 'reasoning' &&
            (later as { text?: string }).text === (p as { text?: string }).text,
        );
    }));
  });

  it('is idempotent when step-start markers are already present', () => {
    const parts = [
      { type: 'reasoning', text: '第一段' },
      { type: 'step-start' },
      { type: 'reasoning', text: '第二段' },
      { type: 'step-start' },
      { type: 'text', text: '收尾' },
    ];

    const once = dedupeAssistantMessageParts(parts);
    const twice = dedupeAssistantMessageParts(once);
    assert.equal(twice, once);
  });

  it('starts a new logical step after a completed suspend tool without step-start', () => {
    const intro = '第一段说明';
    const parts = dedupeAssistantMessageParts([
      { type: 'reasoning', text: intro },
      {
        type: 'tool-ask_user_question',
        state: 'output-available',
        output: { answers: { Q: 'A' } },
      },
      { type: 'reasoning', text: intro },
      { type: 'text', text: '第二段新问题' },
    ]);

    assert.deepEqual(
      parts.map((p) => (p as { type?: string }).type),
      ['reasoning', 'tool-ask_user_question', 'step-start', 'text'],
    );
  });
});
