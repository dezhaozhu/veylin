import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import type { MastraDBMessage } from '@mastra/core/memory';
import { ContextCompression, estimateTokens } from './contextCompression.js';
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

  const prevTokenTrigger = process.env.VEYLIN_COMPACT_TOKEN_TRIGGER;

  beforeEach(() => {
    resetCompactCircuitBreaker();
    delete process.env.VEYLIN_COMPACT_KEEP;
    delete process.env.VEYLIN_COMPACT_TRIGGER;
    delete process.env.VEYLIN_COMPACT_TOKEN_TRIGGER;
  });

  it('estimates tokens from message text', () => {
    const tokens = estimateTokens([textMessage('a'.repeat(400), 0)]);
    assert.equal(tokens, 100);
  });

  it('compacts when estimated tokens exceed token trigger', async () => {
    process.env.VEYLIN_COMPACT_TOKEN_TRIGGER = '50';
    process.env.VEYLIN_COMPACT_KEEP = '1';

    const compressor = new ContextCompression({ keepRecent: 1, triggerAt: 999 });
    const messages = [
      textMessage('old context '.repeat(30), 0),
      textMessage('old context '.repeat(30), 1),
      textMessage('recent tail', 2),
    ];

    const out = await compressor.processInput({ messages });
    assert.equal(out.length, 2);
    const summary = (out[0] as { content: { parts: { text?: string }[] } }).content.parts[0]?.text ?? '';
    assert.match(summary, /compacted/i);
    assert.match(summary, /Resume unfinished work silently/i);
    assert.match((out[1] as { content: { parts: { text?: string }[] } }).content.parts[0]?.text ?? '', /recent tail/);
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
    if (prevTokenTrigger === undefined) delete process.env.VEYLIN_COMPACT_TOKEN_TRIGGER;
    else process.env.VEYLIN_COMPACT_TOKEN_TRIGGER = prevTokenTrigger;
    resetCompactCircuitBreaker();
  });
});
