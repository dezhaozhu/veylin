import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clearProviderContextWindowCache,
  extractContextWindowFromModelRecord,
  findModelRecordInList,
} from './provider-context-window.js';

describe('extractContextWindowFromModelRecord', () => {
  it('reads OpenRouter context_length', () => {
    assert.equal(
      extractContextWindowFromModelRecord({ id: 'google/gemini-3.1-flash', context_length: 1_048_576 }),
      1_048_576,
    );
  });

  it('reads vLLM max_model_len', () => {
    assert.equal(
      extractContextWindowFromModelRecord({ id: 'local', max_model_len: 32_768 }),
      32_768,
    );
  });

  it('reads top_provider.context_length', () => {
    assert.equal(
      extractContextWindowFromModelRecord({
        id: 'x',
        top_provider: { context_length: 200_000 },
      }),
      200_000,
    );
  });
});

describe('findModelRecordInList', () => {
  const list = [
    { id: 'google/gemini-3.1-flash-lite', context_length: 1_048_576 },
    { id: 'deepseek-chat', context_length: 128_000 },
  ];

  it('matches exact id', () => {
    const hit = findModelRecordInList(list, 'deepseek-chat');
    assert.equal(extractContextWindowFromModelRecord(hit), 128_000);
  });

  it('matches provider/model suffix', () => {
    const hit = findModelRecordInList(list, 'gemini-3.1-flash-lite');
    assert.equal(extractContextWindowFromModelRecord(hit), 1_048_576);
  });
});

describe('clearProviderContextWindowCache', () => {
  it('is safe to call', () => {
    clearProviderContextWindowCache();
  });
});
