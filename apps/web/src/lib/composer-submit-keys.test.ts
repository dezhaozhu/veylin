import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  composerHasSendableDraft,
  resolveEnterWhileRunning,
} from './composer-submit-keys';

describe('composer-submit-keys', () => {
  it('resolveEnterWhileRunning queues only while running with draft text', () => {
    assert.equal(
      resolveEnterWhileRunning({
        isRunning: true,
        canQueue: true,
        composerEmpty: false,
      }),
      'queue',
    );
    assert.equal(
      resolveEnterWhileRunning({
        isRunning: false,
        canQueue: true,
        composerEmpty: false,
      }),
      'ignore',
    );
    assert.equal(
      resolveEnterWhileRunning({
        isRunning: true,
        canQueue: true,
        composerEmpty: true,
      }),
      'ignore',
    );
  });

  it('composerHasSendableDraft treats pending skill as non-empty', () => {
    assert.equal(
      composerHasSendableDraft({ composerEmpty: true, hasPendingSkill: true }),
      true,
    );
    assert.equal(
      composerHasSendableDraft({ composerEmpty: true, hasPendingSkill: false }),
      false,
    );
  });

  it('resolveEnterWhileRunning queues with pending skill only', () => {
    assert.equal(
      resolveEnterWhileRunning({
        isRunning: true,
        canQueue: true,
        composerEmpty: true,
        hasPendingSkill: true,
      }),
      'queue',
    );
  });
});
