import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UIMessage } from 'ai';
import {
  createFrontendToolContinuationController,
  requestFrontendToolContinuation,
  tryContinueFrontendToolChat,
} from './frontend-tool-continuation';

function answeredFirstRoundAskMessage(): UIMessage[] {
  return [
    {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: '调用工具问我问题' }],
    },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Let me ask.' },
        {
          type: 'tool-ask_user_question',
          toolCallId: 'ask-1',
          state: 'output-available',
          providerExecuted: true,
          output: {
            answers: { '你目前最想了解 AI/ML 领域的哪个方向？': '最新模型动态' },
          },
        },
      ],
    },
  ] as UIMessage[];
}

function answeredFirstRoundWithStepStart(): UIMessage[] {
  return [
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-ask_user_question',
          toolCallId: 'ask-1',
          state: 'output-available',
          providerExecuted: true,
          output: {
            answers: { Q: 'A' },
          },
        },
        { type: 'step-start' },
      ],
    },
  ] as UIMessage[];
}

async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  }
}

describe('frontend-tool-continuation', () => {
  it('first round: fast answer while streaming sends once stream becomes ready', async () => {
    let status: 'streaming' | 'ready' = 'streaming';
    let stopCount = 0;
    let sendCount = 0;
    const controller = createFrontendToolContinuationController();
    const messages = answeredFirstRoundAskMessage();

    const args = {
      controller,
      getStatus: () => status,
      getMessages: () => messages,
      stopStream: () => {
        stopCount += 1;
      },
      sendMessage: async () => {
        sendCount += 1;
      },
    };

    requestFrontendToolContinuation(controller, () => {
      void tryContinueFrontendToolChat(args);
    });

    assert.equal(controller.pending, true);
    assert.equal(stopCount, 1);
    assert.equal(sendCount, 0);

    status = 'ready';
    await tryContinueFrontendToolChat(args);
    await flushMicrotasks();

    assert.equal(sendCount, 1);
    assert.equal(controller.pending, false);
  });

  it('first round: abort settling asynchronously still continues via microtask retry', async () => {
    let status: 'streaming' | 'ready' = 'streaming';
    let sendCount = 0;
    const controller = createFrontendToolContinuationController();
    const messages = answeredFirstRoundWithStepStart();

    const args = {
      controller,
      getStatus: () => status,
      getMessages: () => messages,
      stopStream: () => {
        queueMicrotask(() => {
          status = 'ready';
        });
      },
      sendMessage: async () => {
        sendCount += 1;
      },
    };

    requestFrontendToolContinuation(controller, () => {
      void tryContinueFrontendToolChat(args);
    });

    await flushMicrotasks(8);

    assert.equal(sendCount, 1);
    assert.equal(controller.pending, false);
  });

  it('does not stop when continuation POST is already submitted', async () => {
    let stopCount = 0;
    let sendCount = 0;
    const controller = createFrontendToolContinuationController();
    const messages = answeredFirstRoundAskMessage();

    await tryContinueFrontendToolChat({
      controller,
      getStatus: () => 'submitted',
      getMessages: () => messages,
      stopStream: () => {
        stopCount += 1;
      },
      sendMessage: async () => {
        sendCount += 1;
      },
    });

    controller.pending = true;
    await tryContinueFrontendToolChat({
      controller,
      getStatus: () => 'submitted',
      getMessages: () => messages,
      stopStream: () => {
        stopCount += 1;
      },
      sendMessage: async () => {
        sendCount += 1;
      },
    });

    assert.equal(stopCount, 0);
    assert.equal(sendCount, 0);
    assert.equal(controller.pending, false);
  });

  it('second round: ready status sends immediately without extra stop', async () => {
    let stopCount = 0;
    let sendCount = 0;
    const controller = createFrontendToolContinuationController();
    const messages = answeredFirstRoundAskMessage();

    requestFrontendToolContinuation(controller, () => {
      void tryContinueFrontendToolChat({
        controller,
        getStatus: () => 'ready',
        getMessages: () => messages,
        stopStream: () => {
          stopCount += 1;
        },
        sendMessage: async () => {
          sendCount += 1;
        },
      });
    });

    await flushMicrotasks();

    assert.equal(stopCount, 0);
    assert.equal(sendCount, 1);
    assert.equal(controller.pending, false);
  });
});
