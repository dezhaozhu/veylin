import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import type { MastraDBMessage } from '@mastra/core/memory';
import {
  ContextCompression,
  estimateTokens,
  VEYLIN_CONTEXT_COMPACTED_KEY,
  buildContextSummarizedStreamChunk,
  type VeylinContextCompacted,
} from './contextCompression.js';
import { resetCompactCircuitBreaker } from '../context-window.js';

function textMessage(text: string, index: number): MastraDBMessage {
  return {
    id: `msg-${index}`,
    role: 'user',
    createdAt: new Date(),
    content: { parts: [{ type: 'text', text }] },
  } as unknown as MastraDBMessage;
}

describe('ContextCompression', () => {
  const prevWindow = process.env.VEYLIN_AUTOCOMPACT_WINDOW;
  const prevPct = process.env.VEYLIN_AUTOCOMPACT_PCT;
  const prevBuffer = process.env.VEYLIN_AUTOCOMPACT_BUFFER;
  const prevKeep = process.env.VEYLIN_COMPACT_KEEP;
  const prevTokenLimit = process.env.VEYLIN_TOKEN_LIMIT;

  beforeEach(() => {
    resetCompactCircuitBreaker();
    delete process.env.VEYLIN_COMPACT_KEEP;
    delete process.env.VEYLIN_AUTOCOMPACT_PCT;
    delete process.env.VEYLIN_AUTOCOMPACT_BUFFER;
    delete process.env.VEYLIN_AUTOCOMPACT_WINDOW;
    delete process.env.VEYLIN_TOKEN_LIMIT;
  });

  it('estimates tokens from message text', () => {
    const tokens = estimateTokens([textMessage('a'.repeat(400), 0)]);
    assert.equal(tokens, 100);
  });

  it('estimates tokens including tool-result parts', () => {
    const msg = {
      id: 'tool-1',
      role: 'tool',
      createdAt: new Date(),
      content: {
        parts: [
          {
            type: 'tool-result',
            toolName: 'web_fetch',
            result: { body: 'x'.repeat(400) },
          },
        ],
      },
    } as unknown as MastraDBMessage;
    const tokens = estimateTokens([msg]);
    assert.ok(tokens > 50, `expected tool payload to count toward tokens, got ${tokens}`);
  });

  it('does not auto-compact on short threads under window threshold', async () => {
    // Large window → high threshold; ~4k tokens must not trigger (old 4k absolute line removed).
    process.env.VEYLIN_TOKEN_LIMIT = '1_048_576'.replace('_', '');
    process.env.VEYLIN_TOKEN_LIMIT = '1048576';
    const compressor = new ContextCompression({ keepRecent: 1 });
    const big = textMessage('a'.repeat(16_004), 0); // ~4001 tokens
    const recent = textMessage('tail', 1);
    const out = await compressor.processInput({ messages: [big, recent] });
    assert.equal(out.length, 2);
    assert.equal(out[0], big);
  });

  it('compacts when estimated tokens exceed autocompact threshold', async () => {
    process.env.VEYLIN_TOKEN_LIMIT = '50000';
    process.env.VEYLIN_AUTOCOMPACT_WINDOW = '50000';
    process.env.VEYLIN_AUTOCOMPACT_PCT = '5'; // effective 30k → threshold 1500
    process.env.VEYLIN_COMPACT_KEEP = '1';

    const compressor = new ContextCompression({ keepRecent: 1 });
    const messages = [
      textMessage('old context '.repeat(800), 0), // ~2400 tokens
      textMessage('old context '.repeat(800), 1),
      textMessage('recent tail', 2),
    ];

    const out = await compressor.processInput({ messages });
    assert.equal(out.length, 2);
    const summary = (out[0] as { content: { parts: { text?: string }[] } }).content.parts[0]?.text ?? '';
    assert.match(summary, /compacted/i);
    assert.match(summary, /Resume unfinished work silently/i);
    assert.match((out[1] as { content: { parts: { text?: string }[] } }).content.parts[0]?.text ?? '', /recent tail/);
  });

  it('force=true compacts even under thresholds', async () => {
    process.env.VEYLIN_TOKEN_LIMIT = '1048576';
    const compressor = new ContextCompression({
      keepRecent: 1,
      force: true,
    });
    const messages = [
      textMessage('old a', 0),
      textMessage('old b', 1),
      textMessage('keep me', 2),
    ];
    const out = await compressor.processInput({ messages });
    assert.equal(out.length, 2);
    const summary = (out[0] as { content: { parts: { text?: string }[] } }).content.parts[0]?.text ?? '';
    assert.match(summary, /compacted/i);
  });

  it('without force leaves short threads unchanged', async () => {
    process.env.VEYLIN_TOKEN_LIMIT = '1048576';
    const compressor = new ContextCompression({ keepRecent: 1 });
    const messages = [textMessage('a', 0), textMessage('b', 1)];
    const out = await compressor.processInput({ messages });
    assert.equal(out.length, 2);
    assert.equal(out[0], messages[0]);
  });

  it('sets requestContext when compaction runs', async () => {
    const store = new Map<string, unknown>();
    const requestContext = {
      set: (key: string, value: unknown) => {
        store.set(key, value);
      },
      get: (key: string) => store.get(key),
    };
    const compressor = new ContextCompression({
      keepRecent: 1,
      force: true,
    });
    const messages = [
      textMessage('old a', 0),
      textMessage('old b', 1),
      textMessage('keep me', 2),
    ];
    const out = await compressor.processInput({ messages, requestContext });
    const payload = store.get(VEYLIN_CONTEXT_COMPACTED_KEY) as VeylinContextCompacted | undefined;
    assert.ok(payload);
    assert.equal(payload.beforeMessages, 3);
    assert.equal(payload.afterMessages, out.length);
    assert.equal(typeof payload.beforeTokens, 'number');
    assert.equal(typeof payload.afterTokens, 'number');
    assert.ok(payload.afterMessages < payload.beforeMessages);
  });

  it('does not set requestContext when compaction is skipped', async () => {
    process.env.VEYLIN_TOKEN_LIMIT = '1048576';
    const store = new Map<string, unknown>();
    const requestContext = {
      set: (key: string, value: unknown) => {
        store.set(key, value);
      },
    };
    const compressor = new ContextCompression({ keepRecent: 1 });
    const messages = [textMessage('a', 0), textMessage('b', 1)];
    await compressor.processInput({ messages, requestContext });
    assert.equal(store.has(VEYLIN_CONTEXT_COMPACTED_KEY), false);
  });

  it('buildContextSummarizedStreamChunk uses a stable id from generation', () => {
    const payload: VeylinContextCompacted = {
      beforeTokens: 100,
      afterTokens: 40,
      beforeMessages: 10,
      afterMessages: 3,
      generation: 7,
    };
    const chunk = buildContextSummarizedStreamChunk(payload);
    assert.equal(chunk.type, 'data-veylin-context-summarized');
    assert.equal(chunk.id, 'veylin-context-summarized-7');
    assert.equal(chunk.data, payload);
    // Same generation → same id (AI SDK upserts; prevents duplicate notice lines on redelivery).
    assert.equal(buildContextSummarizedStreamChunk(payload).id, chunk.id);
  });

  afterEach(() => {
    if (prevWindow === undefined) delete process.env.VEYLIN_AUTOCOMPACT_WINDOW;
    else process.env.VEYLIN_AUTOCOMPACT_WINDOW = prevWindow;
    if (prevPct === undefined) delete process.env.VEYLIN_AUTOCOMPACT_PCT;
    else process.env.VEYLIN_AUTOCOMPACT_PCT = prevPct;
    if (prevBuffer === undefined) delete process.env.VEYLIN_AUTOCOMPACT_BUFFER;
    else process.env.VEYLIN_AUTOCOMPACT_BUFFER = prevBuffer;
    if (prevKeep === undefined) delete process.env.VEYLIN_COMPACT_KEEP;
    else process.env.VEYLIN_COMPACT_KEEP = prevKeep;
    if (prevTokenLimit === undefined) delete process.env.VEYLIN_TOKEN_LIMIT;
    else process.env.VEYLIN_TOKEN_LIMIT = prevTokenLimit;
    resetCompactCircuitBreaker();
  });
});
