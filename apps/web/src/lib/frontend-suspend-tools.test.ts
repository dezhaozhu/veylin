import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UIMessage } from 'ai';
import {
  conversationAwaitsResume,
  findFirstAwaitingFrontendToolIndex,
  hasAskUserAnswers,
  isAwaitingFrontendToolAnswer,
} from './frontend-suspend-tools';

describe('frontend suspend tools', () => {
  it('recognizes an unanswered native client tool', () => {
    const parts = [
      {
        type: 'tool-ask_user_question',
        toolCallId: 'ask-1',
        state: 'input-available',
      },
    ];
    assert.equal(findFirstAwaitingFrontendToolIndex(parts), 0);
    assert.equal(
      isAwaitingFrontendToolAnswer([
        { id: 'a', role: 'assistant', parts },
      ] as UIMessage[]),
      true,
    );
    assert.equal(hasAskUserAnswers({ answers: {} }), false);
    assert.equal(hasAskUserAnswers({ answers: { Scope: 'One' } }), true);
  });

  it('does not reconnect a stream that ended in native suspension', () => {
    const messages = [
      {
        id: 'a',
        role: 'assistant',
        parts: [
          {
            type: 'tool-ask_user_question',
            toolCallId: 'ask-1',
            state: 'input-available',
          },
          {
            type: 'data-tool-call-suspended',
            data: {
              runId: 'run-1',
              toolCallId: 'ask-1',
              toolName: 'ask_user_question',
            },
          },
        ],
      },
    ] as UIMessage[];
    assert.equal(conversationAwaitsResume(messages), false);
  });

  it('still reconnects genuinely interrupted server tools', () => {
    const messages = [
      {
        id: 'a',
        role: 'assistant',
        parts: [
          {
            type: 'tool-web_fetch',
            toolCallId: 'fetch-1',
            state: 'input-available',
          },
        ],
      },
    ] as UIMessage[];
    assert.equal(conversationAwaitsResume(messages), true);
  });
});
