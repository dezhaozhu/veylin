import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  clearAskUserSession,
  getAskUserSessionForThread,
} from './ask-user-question-session';
import { registerPendingAskUserSession } from './pending-ask-user-session';
import { registerAskUserResultSubmitter } from './ask-user-submit-bridge';

const message = { id: 'assistant-1', parts: [] as unknown[] };

const askPart = {
  type: 'tool-ask_user_question',
  toolCallId: 'call-1',
  input: {
    questions: [
      {
        question: 'Pick one?',
        header: 'Pick',
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ],
  },
};

afterEach(() => {
  clearAskUserSession('thread-1');
  registerAskUserResultSubmitter('thread-1', null);
});

describe('registerPendingAskUserSession', () => {
  it('opens a session for a pending ask tool call', () => {
    assert.equal(
      registerPendingAskUserSession('thread-1', message, 0, askPart),
      true,
    );
    const session = getAskUserSessionForThread('thread-1');
    assert.equal(session?.toolCallId, 'call-1');
    assert.equal(session?.questions.length, 1);
  });

  it('ignores non-ask tools and asks without questions', () => {
    assert.equal(
      registerPendingAskUserSession('thread-1', message, 0, {
        type: 'tool-read_open_page',
      }),
      false,
    );
    assert.equal(
      registerPendingAskUserSession('thread-1', message, 0, {
        type: 'tool-ask_user_question',
        toolCallId: 'call-2',
        input: { questions: [] },
      }),
      false,
    );
    assert.equal(getAskUserSessionForThread('thread-1'), null);
  });

  it('keeps the existing session when re-registering the same tool call', () => {
    registerPendingAskUserSession('thread-1', message, 0, askPart);
    const first = getAskUserSessionForThread('thread-1');
    registerPendingAskUserSession('thread-1', message, 0, askPart);
    assert.equal(getAskUserSessionForThread('thread-1'), first);
  });

  it('routes answers through the submit bridge', () => {
    const submitted: { toolCallId: string; answer: string }[] = [];
    registerAskUserResultSubmitter('thread-1', (toolCallId, result) => {
      submitted.push({ toolCallId, answer: result.answers['Pick one?'] ?? '' });
    });

    registerPendingAskUserSession('thread-1', message, 0, askPart);
    getAskUserSessionForThread('thread-1')?.addResult({
      questions: [],
      answers: { 'Pick one?': 'A' },
    });

    assert.deepEqual(submitted, [{ toolCallId: 'call-1', answer: 'A' }]);
  });
});
