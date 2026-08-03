import assert from 'node:assert/strict';
import test from 'node:test';
import {
  registerAskUserResultSubmitter,
  submitAskUserResult,
} from './ask-user-submit-bridge';
import type { AskUserResult } from './ask-user-question-session';

const result: AskUserResult = {
  questions: [],
  answers: { Q: 'A' },
};

test('ask user submit bridge routes by thread id', async () => {
  const calls: string[] = [];
  registerAskUserResultSubmitter('thread-a', (toolCallId) => {
    calls.push(`a:${toolCallId}`);
  });
  registerAskUserResultSubmitter('thread-b', (toolCallId) => {
    calls.push(`b:${toolCallId}`);
  });

  const ok = await submitAskUserResult('thread-a', 'call-1', result);

  assert.equal(ok, true);
  assert.deepEqual(calls, ['a:call-1']);

  registerAskUserResultSubmitter('thread-a', null);
  registerAskUserResultSubmitter('thread-b', null);
});

test('ask user submit bridge falls back only for missing thread submitter', async () => {
  let fallbackCalled = false;
  const ok = await submitAskUserResult('thread-missing', 'call-1', result, () => {
    fallbackCalled = true;
  });

  assert.equal(ok, true);
  assert.equal(fallbackCalled, true);
});
