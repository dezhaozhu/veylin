import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearAskUserSession,
  getAskUserSessionForThread,
  hasAskUserSession,
  setAskUserSession,
  subscribeAskUserSession,
} from './ask-user-question-session';

const questions = [
  {
    question: 'Pick one?',
    header: 'Pick',
    options: [{ label: 'A' }],
  },
];

test('ask user session is scoped to the owning thread', () => {
  setAskUserSession({
    threadId: 'thread-a',
    toolCallId: 'call-a',
    questions,
    addResult: () => undefined,
  });

  assert.equal(hasAskUserSession(), true);
  assert.equal(getAskUserSessionForThread('thread-b'), null);
  assert.equal(getAskUserSessionForThread('thread-a')?.toolCallId, 'call-a');

  clearAskUserSession('thread-b', 'call-a');
  assert.equal(getAskUserSessionForThread('thread-a')?.toolCallId, 'call-a');

  clearAskUserSession('thread-a', 'call-a');
  assert.equal(getAskUserSessionForThread('thread-a'), null);
  assert.equal(hasAskUserSession(), false);
});

test('ask user session notifies subscribers when scoped state changes', () => {
  let calls = 0;
  const unsubscribe = subscribeAskUserSession(() => {
    calls += 1;
  });

  setAskUserSession({
    threadId: 'thread-a',
    toolCallId: 'call-a',
    questions,
    addResult: () => undefined,
  });
  clearAskUserSession('thread-a', 'call-a');
  unsubscribe();

  assert.equal(calls, 2);
});
