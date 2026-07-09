import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stampInterruptedAssistant, stampMessageWithSentAt } from './message-timestamp';

describe('stampInterruptedAssistant', () => {
  it('sets interrupted and sentAt on a bare assistant message', () => {
    const stamped = stampInterruptedAssistant({ id: 'a1', role: 'assistant' }, 1_000);
    const custom = (stamped.metadata as { custom?: { sentAt?: number; interrupted?: boolean } })
      ?.custom;
    assert.equal(custom?.interrupted, true);
    assert.equal(custom?.sentAt, 1_000);
  });

  it('preserves an existing sentAt when marking interrupted', () => {
    const withSentAt = stampMessageWithSentAt({ id: 'a1' }, 500);
    const stamped = stampInterruptedAssistant(withSentAt, 999);
    const custom = (stamped.metadata as { custom?: { sentAt?: number; interrupted?: boolean } })
      ?.custom;
    assert.equal(custom?.sentAt, 500);
    assert.equal(custom?.interrupted, true);
  });
});
