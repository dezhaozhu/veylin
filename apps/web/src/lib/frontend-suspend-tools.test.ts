import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UIMessage } from 'ai';
import {
  hasAskUserAnswers,
  isAwaitingFrontendToolPart,
  shouldAutoSendChat,
  trimAssistantAfterAwaitingTool,
} from './frontend-suspend-tools';

describe('frontend-suspend-tools', () => {
  it('treats empty ask answers as pending', () => {
    assert.equal(hasAskUserAnswers({ answers: {} }), false);
    assert.equal(hasAskUserAnswers({ answers: { Q: 'A' } }), true);
    assert.equal(
      isAwaitingFrontendToolPart({
        type: 'tool-ask_user_question',
        state: 'output-available',
        output: { answers: {} },
      }),
      true,
    );
  });

  it('blocks auto-send until ask answers exist', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-ask_user_question',
            state: 'output-available',
            output: { answers: { 'Pick one?': 'A' } },
          },
        ],
      },
    ] as UIMessage[];

    assert.equal(shouldAutoSendChat({ messages }), true);

    messages[0]!.parts![0] = {
      type: 'tool-ask_user_question',
      state: 'input-available',
    } as never;
    assert.equal(shouldAutoSendChat({ messages }), false);
  });

  it('trims assistant text after a pending frontend tool', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'tool-ask_user_question', state: 'input-available' },
          { type: 'text', text: 'Please choose…' },
        ],
      },
    ];

    const trimmed = trimAssistantAfterAwaitingTool(messages);
    assert.equal(trimmed?.[0]?.parts?.length, 1);
  });
});
