import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  getAutoCompactThreshold,
  getEffectiveContextWindowSize,
  getContextWindowSize,
  readAutocompactPctOverride,
  recordCompactFailure,
  recordCompactSuccess,
  resetCompactCircuitBreaker,
  isAutoCompactDisabled,
  AUTOCOMPACT_BUFFER_TOKENS,
  COMPACT_RESERVED_OUTPUT_TOKENS,
} from './context-window.js';

describe('context-window', () => {
  const prevPct = process.env.VEYLIN_AUTOCOMPACT_PCT;
  const prevBuffer = process.env.VEYLIN_AUTOCOMPACT_BUFFER;
  const prevWindow = process.env.VEYLIN_AUTOCOMPACT_WINDOW;
  const prevTokenLimit = process.env.VEYLIN_TOKEN_LIMIT;
  const prevReserved = process.env.VEYLIN_COMPACT_RESERVED_OUTPUT;

  beforeEach(() => {
    delete process.env.VEYLIN_AUTOCOMPACT_PCT;
    delete process.env.VEYLIN_AUTOCOMPACT_BUFFER;
    delete process.env.VEYLIN_AUTOCOMPACT_WINDOW;
    delete process.env.VEYLIN_TOKEN_LIMIT;
    delete process.env.VEYLIN_COMPACT_RESERVED_OUTPUT;
    resetCompactCircuitBreaker();
  });

  it('default threshold is effectiveWindow − 13k (Claude Code)', () => {
    process.env.VEYLIN_TOKEN_LIMIT = '200000';
    const effective = getEffectiveContextWindowSize();
    assert.equal(effective, 200000 - COMPACT_RESERVED_OUTPUT_TOKENS);
    assert.equal(
      getAutoCompactThreshold(),
      effective - AUTOCOMPACT_BUFFER_TOKENS,
    );
  });

  it('PCT override only applies when env is set', () => {
    process.env.VEYLIN_TOKEN_LIMIT = '100000';
    process.env.VEYLIN_AUTOCOMPACT_WINDOW = '100000';
    // effective = min(100000,100000) - 20000 = 80000
    const effective = getEffectiveContextWindowSize();
    assert.equal(effective, 80_000);
    assert.equal(getAutoCompactThreshold(), 80_000 - 13_000);

    process.env.VEYLIN_AUTOCOMPACT_PCT = '0.25';
    assert.equal(readAutocompactPctOverride(), 0.25);
    assert.equal(getAutoCompactThreshold(), Math.floor(80_000 * 0.25));

    process.env.VEYLIN_AUTOCOMPACT_PCT = '5';
    assert.equal(readAutocompactPctOverride(), 0.05);
    assert.equal(getAutoCompactThreshold(), Math.floor(80_000 * 0.05));
  });

  it('VEYLIN_TOKEN_LIMIT overrides catalog resolve', () => {
    process.env.VEYLIN_TOKEN_LIMIT = '64000';
    assert.equal(getContextWindowSize('deepseek-v4-flash'), 64_000);
  });

  it('trips circuit breaker after repeated failures', () => {
    assert.equal(isAutoCompactDisabled(), false);
    recordCompactFailure();
    recordCompactFailure();
    assert.equal(isAutoCompactDisabled(), false);
    recordCompactFailure();
    assert.equal(isAutoCompactDisabled(), true);
    recordCompactSuccess();
    assert.equal(isAutoCompactDisabled(), false);
  });

  afterEach(() => {
    if (prevPct === undefined) delete process.env.VEYLIN_AUTOCOMPACT_PCT;
    else process.env.VEYLIN_AUTOCOMPACT_PCT = prevPct;
    if (prevBuffer === undefined) delete process.env.VEYLIN_AUTOCOMPACT_BUFFER;
    else process.env.VEYLIN_AUTOCOMPACT_BUFFER = prevBuffer;
    if (prevWindow === undefined) delete process.env.VEYLIN_AUTOCOMPACT_WINDOW;
    else process.env.VEYLIN_AUTOCOMPACT_WINDOW = prevWindow;
    if (prevTokenLimit === undefined) delete process.env.VEYLIN_TOKEN_LIMIT;
    else process.env.VEYLIN_TOKEN_LIMIT = prevTokenLimit;
    if (prevReserved === undefined) delete process.env.VEYLIN_COMPACT_RESERVED_OUTPUT;
    else process.env.VEYLIN_COMPACT_RESERVED_OUTPUT = prevReserved;
    resetCompactCircuitBreaker();
  });
});
