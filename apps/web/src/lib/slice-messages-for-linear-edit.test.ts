import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UIMessage } from 'ai';
import { sliceMessagesForLinearEdit } from './slice-messages-for-linear-edit';

describe('sliceMessagesForLinearEdit', () => {
  it('drops consecutive duplicate user sends before the edited message', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'same' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'same' }] },
      { id: 'u3', role: 'user', parts: [{ type: 'text', text: 'same' }] },
      { id: 'u4', role: 'user', parts: [{ type: 'text', text: 'same' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'reply' }] },
    ] as UIMessage[];

    const sliced = sliceMessagesForLinearEdit(messages, 'u4', 'u3');
    assert.deepEqual(
      sliced.map((message) => message.id),
      [],
    );
  });

  it('keeps history through the last assistant before a normal edit', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'first' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'one' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'second' }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'two' }] },
    ] as UIMessage[];

    const sliced = sliceMessagesForLinearEdit(messages, 'u2', 'a1');
    assert.deepEqual(
      sliced.map((message) => message.id),
      ['u1', 'a1'],
    );
  });
});
