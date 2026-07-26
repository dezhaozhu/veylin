import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UIMessage } from 'ai';
import {
  consumeNativeResumeRequest,
  findNativeToolSuspension,
  stageNativeResumeRequest,
} from './native-suspend-resume';

describe('native suspend resume', () => {
  it('reads the exact Mastra suspension identity', () => {
    const messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'data-tool-call-suspended',
            id: 'ask-1',
            data: {
              runId: 'run-1',
              toolCallId: 'ask-1',
              toolName: 'ask_user_question',
              suspendPayload: { questions: [] },
              state: 'input-available',
              suspendedAt: 1_000,
            },
          },
        ],
      },
    ] as UIMessage[];
    assert.deepEqual(findNativeToolSuspension(messages, 'ask-1'), {
      runId: 'run-1',
      toolCallId: 'ask-1',
      toolName: 'ask_user_question',
      suspendPayload: { questions: [] },
      state: 'input-available',
      suspendedAt: 1_000,
    });
  });

  it('consumes a resume request once', () => {
    const request = {
      threadId: 'thread-1',
      runId: 'run-1',
      toolCallId: 'ask-1',
      resumeData: { answers: { Scope: 'One device' } },
    };
    stageNativeResumeRequest(request);
    assert.deepEqual(consumeNativeResumeRequest('thread-1'), request);
    assert.equal(consumeNativeResumeRequest('thread-1'), null);
  });

  it('does not reuse suspension metadata from an older user turn', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'data-tool-call-suspended',
            data: {
              runId: 'old-run',
              toolCallId: 'old-call',
              toolName: 'ask_user_question',
            },
          },
        ],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'new turn' }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'working' }] },
    ] as UIMessage[];
    assert.equal(findNativeToolSuspension(messages), null);
  });
});
