import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { textOfMessage, toAgentMessages } from './chat.js';

describe('chat message conversion', () => {
  it('turns answered ask_user_question into continuation text', async () => {
    const assistantWithAnswer = {
      role: 'assistant',
      parts: [
        {
          type: 'tool-ask_user_question',
          toolCallId: 'ask-1',
          state: 'output-available',
          providerExecuted: true,
          output: {
            answers: {
              '你今天想聊什么？': '工作相关',
            },
          },
        },
      ],
    };

    assert.match(
      textOfMessage(assistantWithAnswer),
      /User has answered your questions/,
    );

    const converted = await toAgentMessages([
      {
        role: 'user',
        parts: [{ type: 'text', text: '调用工具问我问题' }],
      },
      assistantWithAnswer,
    ]);

    assert.deepEqual(converted, [
      { role: 'user', content: '调用工具问我问题' },
      {
        role: 'user',
        content:
          'User has answered your questions: "你今天想聊什么？"="工作相关". You can now continue with the user\'s answers in mind.',
      },
    ]);
  });
});
