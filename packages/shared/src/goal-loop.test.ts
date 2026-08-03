import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clampLoopWakeupSeconds,
  DEFAULT_GOAL_MAX_TURNS,
  extractIntervalFromText,
  formatIntervalSeconds,
  parseIntervalToSeconds,
} from './goal-loop.js';

describe('goal-loop shared', () => {
  it('exports default max turns', () => {
    assert.equal(DEFAULT_GOAL_MAX_TURNS, 100);
  });

  it('parses intervals', () => {
    assert.equal(parseIntervalToSeconds('1d'), 86400);
    assert.equal(formatIntervalSeconds(86400), '1d');
    assert.equal(clampLoopWakeupSeconds(120), 120);
  });

  it('extracts intervals from free text', () => {
    assert.equal(extractIntervalFromText('5m'), 300);
    assert.equal(extractIntervalFromText('每10分钟检查 CI'), 600);
    assert.equal(extractIntervalFromText('check deploy every 2 hours'), 7200);
    assert.equal(extractIntervalFromText('just check CI'), null);
  });
});
