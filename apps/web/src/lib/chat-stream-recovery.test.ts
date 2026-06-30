import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UIMessage } from 'ai';
import { isStuckAwaitingToolContinuation } from './chat-stream-recovery';

describe('chat-stream-recovery', () => {
  it('detects a streaming run wedged on an answered frontend-suspend tool', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-ask_user_question',
            state: 'output-available',
            providerExecuted: true,
            toolCallId: 't1',
            output: { answers: { q1: ['yes'] } },
          },
        ],
      },
    ] as UIMessage[];

    assert.equal(isStuckAwaitingToolContinuation(messages, 'streaming'), true);
    assert.equal(isStuckAwaitingToolContinuation(messages, 'submitted'), true);
    assert.equal(isStuckAwaitingToolContinuation(messages, 'ready'), false);
  });

  it('does NOT treat an in-progress server tool (subagent task) as stuck', () => {
    // A providerExecuted server tool sitting at input-available means the server
    // is still executing it (e.g. a synchronous subagent). The stream is alive;
    // force-recovering here would abort the live run and cancel the subagent.
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-task',
            state: 'input-available',
            providerExecuted: true,
            toolCallId: 't1',
            input: { subagent_type: 'explore' },
          },
        ],
      },
    ] as UIMessage[];

    assert.equal(isStuckAwaitingToolContinuation(messages, 'streaming'), false);
    assert.equal(isStuckAwaitingToolContinuation(messages, 'submitted'), false);
  });

  it('does NOT treat a completed server tool as stuck while still streaming', () => {
    // The server stream is alive and will produce the follow-up summary itself.
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-knowledge_search',
            state: 'output-available',
            providerExecuted: true,
            toolCallId: 't1',
            output: { hits: [] },
          },
        ],
      },
    ] as UIMessage[];

    assert.equal(isStuckAwaitingToolContinuation(messages, 'streaming'), false);
  });

  it('ignores a frontend-suspend tool that already has a follow-up reply', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-ask_user_question',
            state: 'output-available',
            providerExecuted: true,
            toolCallId: 't1',
            output: { answers: { q1: ['yes'] } },
          },
          { type: 'step-start' },
          { type: 'text', text: 'done' },
        ],
      },
    ] as UIMessage[];

    assert.equal(isStuckAwaitingToolContinuation(messages, 'streaming'), false);
  });
});
