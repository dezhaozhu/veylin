import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ThreadMessage } from '@assistant-ui/core';
import { bindExternalStoreMessage } from '@assistant-ui/core';
import type { UIMessage } from 'ai';
import {
  getActiveBranchThreadMessages,
  resolveThreadMessagesToUi,
} from './resolve-branch-ui-messages';

const assistant = (id: string, text: string): ThreadMessage =>
  ({
    id,
    role: 'assistant',
    createdAt: new Date(),
    content: [{ type: 'text', text }],
    status: { type: 'complete', reason: 'stop' },
    metadata: { custom: {} },
  }) as ThreadMessage;

describe('resolveThreadMessagesToUi', () => {
  it('uses bound external store messages when present', () => {
    const message = assistant('a1', 'hello');
    const ui: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hello' }],
    };
    bindExternalStoreMessage(message, ui);

    assert.deepEqual(resolveThreadMessagesToUi([message], new Map()), [ui]);
  });

  it('falls back to cached UI messages by thread id', () => {
    const message = assistant('a1', 'hello');
    const ui: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hello' }],
    };

    assert.deepEqual(
      resolveThreadMessagesToUi([message], new Map([['a1', ui]])),
      [ui],
    );
  });

  it('reconstructs text assistant messages when no binding exists', () => {
    const message = assistant('a1', 'hello');
    const resolved = resolveThreadMessagesToUi([message], new Map());
    assert.deepEqual(resolved, [
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  it('getActiveBranchThreadMessages follows head to root', () => {
    const user = assistant('u1', 'hi');
    (user as { role: string }).role = 'user';
    const a1 = assistant('a1', 'branch one');
    const a2 = assistant('a2', 'branch two');

    const exported = {
      headId: 'a1',
      messages: [
        { message: user, parentId: null },
        { message: a1, parentId: 'u1' },
        { message: a2, parentId: 'u1' },
      ],
    };

    assert.deepEqual(getActiveBranchThreadMessages(exported), [user, a1]);
  });

  it('resolves unbound sibling branch via reconstruction + cache', () => {
    const user = assistant('u1', '你好');
    (user as { role: string }).role = 'user';
    const a1 = assistant('a1', 'first answer');

    const cached: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'first answer' }],
    };

    const resolved = resolveThreadMessagesToUi([user, a1], new Map([['a1', cached]]));
    assert.equal(resolved.length, 2);
    assert.equal(resolved[1]?.parts[0]?.type, 'text');
  });
});
