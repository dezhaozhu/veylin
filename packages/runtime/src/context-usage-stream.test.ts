import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONTEXT_USAGE_DATA_PART,
  CONTEXT_USAGE_DATA_PART_ID,
  buildContextUsageStreamChunk,
  normalizeContextUsage,
} from './context-usage-stream.js';

describe('normalizeContextUsage', () => {
  it('accepts AI SDK / Mastra camelCase usage', () => {
    const usage = normalizeContextUsage({
      inputTokens: 1200,
      outputTokens: 80,
      cachedInputTokens: 100,
      cacheCreationInputTokens: 40,
    });
    assert.deepEqual(usage, {
      inputTokens: 1200,
      outputTokens: 80,
      cachedInputTokens: 100,
      cacheCreationInputTokens: 40,
    });
  });

  it('accepts Anthropic snake_case and defaults missing output to 0', () => {
    const usage = normalizeContextUsage({
      input_tokens: 500,
      cache_read_input_tokens: 20,
    });
    assert.deepEqual(usage, {
      inputTokens: 500,
      outputTokens: 0,
      cachedInputTokens: 20,
    });
  });

  it('reads v6 inputTokenDetails cache fields', () => {
    const usage = normalizeContextUsage({
      inputTokens: 10,
      outputTokens: 1,
      inputTokenDetails: { cacheReadTokens: 3, cacheWriteTokens: 2 },
    });
    assert.equal(usage?.cachedInputTokens, 3);
    assert.equal(usage?.cacheCreationInputTokens, 2);
  });
});

describe('buildContextUsageStreamChunk', () => {
  it('uses a stable id for upsert semantics', () => {
    const chunk = buildContextUsageStreamChunk({
      inputTokens: 42,
      outputTokens: 7,
    });
    assert.ok(chunk);
    assert.equal(chunk.type, CONTEXT_USAGE_DATA_PART);
    assert.equal(chunk.id, CONTEXT_USAGE_DATA_PART_ID);
    assert.equal(chunk.data.inputTokens, 42);
  });

  it('returns null for unusable payloads', () => {
    assert.equal(buildContextUsageStreamChunk(null), null);
    assert.equal(buildContextUsageStreamChunk({ outputTokens: 1 }), null);
  });
});
