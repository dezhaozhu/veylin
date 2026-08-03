import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_CONTEXT_WINDOW_FALLBACK,
  lookupKnownModelContextWindow,
} from './known-model-context-windows.js';
import {
  resolveContextWindowSize,
  resolveModelContextWindow,
} from './model-context-window.js';

describe('lookupKnownModelContextWindow', () => {
  it('matches exact DeepSeek V4 ids', () => {
    assert.equal(lookupKnownModelContextWindow('deepseek-v4-flash'), 1_048_576);
    assert.equal(lookupKnownModelContextWindow('DeepSeek-V4-Pro'), 1_048_576);
  });

  it('matches org/model suffix exactly, not substring includes', () => {
    assert.equal(lookupKnownModelContextWindow('acme/deepseek-v4-flash'), 1_048_576);
    assert.equal(lookupKnownModelContextWindow('deepseek-something-else'), null);
  });
});

describe('resolveModelContextWindow / resolveContextWindowSize', () => {
  it('returns explicit catalog contextWindow', () => {
    assert.equal(
      resolveModelContextWindow({
        id: 'gemini',
        label: 'Gemini-3.1-flash',
        contextWindow: 1_048_576,
      }),
      1_048_576,
    );
  });

  it('explicit-only helper stays null without catalog field', () => {
    assert.equal(
      resolveModelContextWindow({ id: 'g', label: 'Gemini-3.1-flash' }),
      null,
    );
  });

  it('full resolve uses known registry then 272k fallback', () => {
    assert.equal(
      resolveContextWindowSize({ modelId: 'deepseek-v4-flash' }),
      1_048_576,
    );
    assert.equal(
      resolveContextWindowSize({ id: 'unknown-local', modelId: 'my-custom-32k' }),
      DEFAULT_CONTEXT_WINDOW_FALLBACK,
    );
    assert.equal(DEFAULT_CONTEXT_WINDOW_FALLBACK, 272_000);
  });

  it('catalog override beats registry', () => {
    assert.equal(
      resolveContextWindowSize({
        modelId: 'deepseek-v4-flash',
        contextWindow: 64_000,
      }),
      64_000,
    );
  });
});
