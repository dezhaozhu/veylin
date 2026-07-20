import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeContextUsageSnapshot,
  contextUsageSignature,
  formatTokenCount,
  getLastTokenUsageFromMessages,
  getModelContextWindow,
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

    const snapshot = computeContextUsageSnapshot(tokens, 'default', null, {
      contextWindow: 1_000_000,
    });
    assert.equal(snapshot.isEstimate, true);
    assert.ok(snapshot.usedPercent != null && snapshot.usedPercent > 0);
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

describe('contextUsageSignature', () => {
  it('changes when ThreadMessage content grows without parts', () => {
    const base = [
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
      },
    ];
    const grown = [
      {
        id: 'a1',
        role: 'assistant',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'tool-call', toolName: 'table_get', argsText: '{}' },
        ],
      },
    ];
    assert.notEqual(contextUsageSignature(base), contextUsageSignature(grown));
  });

  it('changes when last text crosses the length bucket', () => {
    const short = [
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'x'.repeat(10) }],
      },
    ];
    const long = [
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'x'.repeat(300) }],
      },
    ];
    assert.notEqual(contextUsageSignature(short), contextUsageSignature(long));
  });
});

describe('getLastTokenUsageFromMessages steps usage', () => {
  it('uses the last step only (does not sum multi-step inputs)', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        metadata: {
          custom: {},
          steps: [
            { usage: { inputTokens: 1200, outputTokens: 80 } },
            { usage: { inputTokens: 400, outputTokens: 20, cachedInputTokens: 100 } },
          ],
        },
      },
    ];
    const usage = getLastTokenUsageFromMessages(messages);
    assert.ok(usage);
    assert.equal(usage.input_tokens, 400);
    assert.equal(usage.output_tokens, 20);
    assert.equal(usage.cache_read_input_tokens, 100);

    const snapshot = computeContextUsageSnapshot(
      getTokenCountFromUsageForTest(usage),
      'default',
      usage,
      { contextWindow: 128_000 },
    );
    assert.equal(snapshot.contextWindow, 128_000);
    // % = (400 + 100) / 128000 ≈ 0.39% → rounds to 0
    assert.equal(snapshot.usedPercent, 0);
    assert.equal(snapshot.isEstimate, false);
  });

  it('reads data-veylin-context-usage parts from the stream', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'ok' },
          {
            type: 'data-veylin-context-usage',
            id: 'veylin-context-usage',
            data: {
              inputTokens: 50_000,
              outputTokens: 200,
              cachedInputTokens: 1_000,
            },
          },
        ],
      },
    ];
    const usage = getLastTokenUsageFromMessages(messages);
    assert.ok(usage);
    assert.equal(usage.input_tokens, 50_000);
    assert.equal(usage.cache_read_input_tokens, 1_000);

    const snapshot = computeContextUsageSnapshot(51_200, 'default', usage, {
      contextWindow: 128_000,
    });
    assert.equal(snapshot.usedPercent, 40);
    assert.equal(snapshot.isEstimate, false);
  });

  it('falls back to 272k when catalog/provider window is missing', () => {
    const snapshot = computeContextUsageSnapshot(900, 'gemini-3-1-flash', null);
    assert.equal(snapshot.contextWindow, 272_000);
    assert.ok(snapshot.usedPercent != null);
    assert.equal(snapshot.estimatedTokens, 900);
    assert.equal(snapshot.isEstimate, true);
  });

  it('floors tiny non-zero transcript estimates to 1% for ring visibility', () => {
    const snapshot = computeContextUsageSnapshot(393, 'default', null, {
      contextWindow: 1_048_576,
    });
    assert.equal(snapshot.isEstimate, true);
    assert.equal(snapshot.usedPercent, 1);
  });
});

describe('getModelContextWindow', () => {
  it('uses known registry / 272k fallback / explicit catalog', () => {
    assert.equal(getModelContextWindow('deepseek-v4-flash'), 1_048_576);
    assert.equal(getModelContextWindow('gemini-3-1-flash'), 272_000);
    assert.equal(
      getModelContextWindow('gemini-3-1-flash', { contextWindow: 1_048_576 }),
      1_048_576,
    );
    assert.equal(formatTokenCount(1_048_576), '1.05M');
  });
});

function getTokenCountFromUsageForTest(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}): number {
  return (
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    usage.output_tokens
  );
}
