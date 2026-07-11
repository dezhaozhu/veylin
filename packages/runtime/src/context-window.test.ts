import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  getAutoCompactThreshold,
  recordCompactFailure,
  recordCompactSuccess,
  resetCompactCircuitBreaker,
  isAutoCompactDisabled,
} from './context-window.js';

describe('context-window', () => {
  const prevPct = process.env.VEYLIN_AUTOCOMPACT_PCT;
  const prevBuffer = process.env.VEYLIN_AUTOCOMPACT_BUFFER;
  const prevWindow = process.env.VEYLIN_AUTOCOMPACT_WINDOW;

  beforeEach(() => {
    delete process.env.VEYLIN_AUTOCOMPACT_PCT;
    delete process.env.VEYLIN_AUTOCOMPACT_BUFFER;
    delete process.env.VEYLIN_AUTOCOMPACT_WINDOW;
    resetCompactCircuitBreaker();
  });

  it('computes auto-compact threshold from window percentage', () => {
    process.env.VEYLIN_AUTOCOMPACT_WINDOW = '100000';
    process.env.VEYLIN_AUTOCOMPACT_PCT = '0.70';
    process.env.VEYLIN_AUTOCOMPACT_BUFFER = '10000';

    const threshold = getAutoCompactThreshold();
    assert.equal(threshold, 60000);
  });

  it('defaults to 70% of window when pct unset', () => {
    process.env.VEYLIN_AUTOCOMPACT_WINDOW = '100000';
    process.env.VEYLIN_AUTOCOMPACT_BUFFER = '1000';
    const threshold = getAutoCompactThreshold();
    // 100000 * 0.70 - 1000
    assert.equal(threshold, 69000);
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
    resetCompactCircuitBreaker();
  });
});
