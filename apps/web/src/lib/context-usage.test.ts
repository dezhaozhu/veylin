import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeContextUsageSnapshot,
  measureContextTokenCount,
  tokenCountWithEstimation,
} from './context-usage.ts';

describe('context-usage historical thread messages', () => {
  it('counts assistant-ui ThreadMessage content arrays', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: '你问我一下我要干嘛' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '好的！我来问您几个问题，帮您明确需求' },
          {
            type: 'tool-call',
            toolName: 'ask_user_question',
            argsText: '{"questions":[{"prompt":"请选择"}]}',
          },
          { type: 'text', text: '请选择上面的一项，告诉我您想做什么，我来全力协助您！' },
        ],
      },
    ];

    const tokens = tokenCountWithEstimation(messages);
    assert.ok(tokens > 0, 'expected non-zero token estimate from content[] messages');

    const snapshot = computeContextUsageSnapshot(tokens, 'default', null);
    assert.ok(snapshot.usedPercent > 0, 'expected visible ring percent for non-empty history');
    assert.ok(snapshot.estimatedTokens > 0);
  });

  it('still counts UIMessage parts arrays', () => {
    const messages = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'hello world' }],
      },
    ];
    assert.equal(measureContextTokenCount(messages), 3);
  });
});
