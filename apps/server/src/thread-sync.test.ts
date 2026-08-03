import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveTodosForReplacedTranscript,
  shouldReplaceFromClient,
} from './thread-sync';
import type { UiMessage } from './message-sync';

describe('shouldReplaceFromClient', () => {
  it('syncs first client message into empty store', () => {
    assert.equal(
      shouldReplaceFromClient([], [{ id: 'u1', role: 'user', parts: [{ type: 'file' }] }]),
      true,
    );
  });

  it('syncs when client appends a new message', () => {
    assert.equal(
      shouldReplaceFromClient(
        [{ id: 'u1', role: 'user' }],
        [
          { id: 'u1', role: 'user' },
          { id: 'a1', role: 'assistant' },
          { id: 'u2', role: 'user', parts: [{ type: 'file' }, { type: 'file' }] },
        ],
      ),
      true,
    );
  });

  it('syncs when client history diverges from store', () => {
    assert.equal(
      shouldReplaceFromClient(
        [{ id: 'u1', role: 'user' }],
        [{ id: 'u9', role: 'user' }],
      ),
      true,
    );
  });

  it('does not replace when client is empty and forceReplace is unset', () => {
    assert.equal(
      shouldReplaceFromClient([{ id: 'u1', role: 'user' }], []),
      false,
    );
  });

  it('replaces when forceReplace is set even if client is empty', () => {
    assert.equal(
      shouldReplaceFromClient([{ id: 'u1', role: 'user' }], [], true),
      true,
    );
  });
});

describe('resolveTodosForReplacedTranscript', () => {
  const olderTodos = [
    { id: '1', content: 'Old plan', status: 'completed' as const },
  ];
  const newerTodos = [
    { id: '2', content: 'Keep this', status: 'pending' as const },
    { id: '3', content: 'Also keep', status: 'in_progress' as const },
  ];

  it('restores the last todo_write still present after truncate', () => {
    const messages: UiMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-todo_write',
            toolName: 'todo_write',
            output: { newTodos: olderTodos },
          },
        ],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'next' }] },
      {
        id: 'a2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-todo_write',
            toolName: 'todo_write',
            output: { newTodos: newerTodos },
          },
        ],
      },
    ];

    assert.deepEqual(resolveTodosForReplacedTranscript(messages), newerTodos);
  });

  it('uses the last todo_write within a single assistant message', () => {
    const messages: UiMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-todo_write',
            toolName: 'todo_write',
            input: {
              todos: [
                { id: '1', content: 'first', status: 'in_progress' as const },
                { id: '2', content: 'second', status: 'pending' as const },
              ],
            },
          },
          { type: 'text', text: 'working…' },
          {
            type: 'tool-todo_write',
            toolName: 'todo_write',
            input: { todos: newerTodos },
            output: { newTodos: newerTodos },
          },
        ],
      },
    ];

    assert.deepEqual(resolveTodosForReplacedTranscript(messages), newerTodos);
  });

  it('falls back to input.todos when output.newTodos is missing', () => {
    const messages: UiMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            toolName: 'todo_write',
            input: { todos: newerTodos },
          },
        ],
      },
    ];

    assert.deepEqual(resolveTodosForReplacedTranscript(messages), newerTodos);
  });

  it('clears todos when truncated transcript has no todo_write', () => {
    const messages: UiMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'edit me' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'ok' }],
      },
    ];

    assert.deepEqual(resolveTodosForReplacedTranscript(messages), []);
  });

  it('clears todos for an empty transcript', () => {
    assert.deepEqual(resolveTodosForReplacedTranscript([]), []);
  });
});
