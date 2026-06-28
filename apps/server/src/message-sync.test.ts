import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mastraMessagesToUi, normalizeRecalledUiMessages } from './message-sync.js';

describe('message-sync recall normalization', () => {
  it('drops model-only continuation user messages', () => {
    const normalized = normalizeRecalledUiMessages([
      {
        role: 'user',
        parts: [{ type: 'text', text: '请用 ask_user_question 问我一个单选题' }],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-ask_user_question',
            state: 'output-available',
            output: { answers: { Q: 'A' } },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'User has answered your questions: "Q"="A". You can now continue with the user\'s answers in mind.',
          },
        ],
      },
      {
        role: 'assistant',
        parts: [{ type: 'text', text: '回答正确！' }],
      },
    ]);

    assert.equal(normalized.length, 3);
    assert.equal(normalized[0]?.role, 'user');
    assert.equal(normalized[1]?.role, 'assistant');
    assert.equal(normalized[2]?.role, 'assistant');
  });

  it('dedupes repeated user turns after assistant content', () => {
    const normalized = normalizeRecalledUiMessages([
      {
        role: 'user',
        id: 'u1',
        parts: [{ type: 'text', text: '请用 ask_user_question 问我一个单选题' }],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-ask_user_question',
            state: 'output-available',
            output: { answers: { Q: 'Python' } },
          },
        ],
      },
      {
        role: 'user',
        id: 'u2',
        parts: [{ type: 'text', text: '请用 ask_user_question 问我一个单选题' }],
      },
      {
        role: 'assistant',
        parts: [{ type: 'text', text: '回答正确！' }],
      },
    ]);

    assert.equal(normalized.length, 3);
    assert.equal(normalized.filter((m) => m.role === 'user').length, 1);
  });

  it('mastraMessagesToUi applies normalization', () => {
    const ui = mastraMessagesToUi([
      {
        role: 'user',
        content: {
          parts: [{ type: 'text', text: 'hello' }],
        },
      },
      {
        role: 'user',
        content: {
          parts: [{ type: 'text', text: 'hello' }],
        },
      },
    ]);

    assert.equal(ui.length, 1);
    assert.equal(ui[0]?.role, 'user');
  });
});
