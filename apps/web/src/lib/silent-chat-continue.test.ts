import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  requestSilentChatContinue,
  setSilentChatContinue,
} from './silent-chat-continue.ts';

describe('silent-chat-continue', () => {
  it('returns false when no runtime is registered', async () => {
    setSilentChatContinue(null);
    assert.equal(await requestSilentChatContinue(), false);
  });

  it('invokes the registered continue fn and returns true', async () => {
    let called = 0;
    setSilentChatContinue(async () => {
      called += 1;
    });
    assert.equal(await requestSilentChatContinue(), true);
    assert.equal(called, 1);
    setSilentChatContinue(null);
  });
});
