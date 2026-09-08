import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldAttemptResume } from './resume-guard';

describe('shouldAttemptResume — 请求在飞时不 resume', () => {
  it('ready / error / 未知 → 可以尝试接流', () => {
    assert.equal(shouldAttemptResume('ready'), true);
    assert.equal(shouldAttemptResume('error'), true);
    assert.equal(shouldAttemptResume(undefined), true);
  });
  it('submitted / streaming → 当前就在跑,不接', () => {
    assert.equal(shouldAttemptResume('submitted'), false);
    assert.equal(shouldAttemptResume('streaming'), false);
  });
});
