import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UIMessage } from 'ai';
import {
  createFrontendToolContinuationController,
  markToolContinuationAttempt,
  MAX_CONTINUE_FAILURES,
  requestFrontendToolContinuation,
  resetFrontendToolContinuationController,
  resetToolContinuationAttemptTracker,
  createToolContinuationAttemptTracker,
  toolContinuationFingerprint,
  tryContinueFrontendToolChat,
  unmarkToolContinuationAttempt,
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

describe('frontend-tool-continuation', () => {
  it('streaming: stops then sends immediately without waiting for ready', async () => {
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
      ensureStopped: async () => {
        stopCount += 1;
      },
      sendMessage: async () => {
        sendCount += 1;
      },
    };

    requestFrontendToolContinuation(controller, () => {
      void tryContinueFrontendToolChat(args);
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    assert.equal(stopCount, 1);
    assert.equal(sendCount, 1);
    assert.equal(controller.pending, false);
    assert.equal(controller.sendStarted, true);
  });

  it('streaming with async stop still sends once stop settles', async () => {
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
      ensureStopped: async () => {
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        status = 'ready';
      },
      sendMessage: async () => {
        sendCount += 1;
      },
    };

    requestFrontendToolContinuation(controller, () => {
      void tryContinueFrontendToolChat(args);
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    assert.equal(sendCount, 1);
    assert.equal(controller.pending, false);
  });

  it('submitted: stops then sends when SDK auto-send is disabled', async () => {
    let stopCount = 0;
    let sendCount = 0;
    const controller = createFrontendToolContinuationController();
    controller.pending = true;
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

    assert.equal(stopCount, 1);
    assert.equal(sendCount, 1);
    assert.equal(controller.pending, false);
  });

  it('ready status sends immediately without extra stop', async () => {
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

    assert.equal(stopCount, 0);
    assert.equal(sendCount, 1);
    assert.equal(controller.pending, false);
  });

  it('does nothing without requestFrontendToolContinuation (pending=false)', async () => {
    let sendCount = 0;
    const controller = createFrontendToolContinuationController();
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-web_fetch',
            toolCallId: 'wf-1',
            state: 'output-available',
            providerExecuted: true,
            output: { result: 'headlines', code: 200, durationMs: 1200 },
          },
        ],
      },
    ] as UIMessage[];

    await tryContinueFrontendToolChat({
      controller,
      getStatus: () => 'ready',
      getMessages: () => messages,
      stopStream: () => undefined,
      sendMessage: async () => {
        sendCount += 1;
      },
    });

    assert.equal(sendCount, 0);
  });

  it('does NOT client-continue after a subagent dispatch (synchronous Task model)', async () => {
    // Subagents now run synchronously inside the server `task` tool call and the
    // parent continues natively; the client must not fire a synthesis re-POST.
    let sendCount = 0;
    const controller = createFrontendToolContinuationController();
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: '子智能体结果到达后我会立即整合汇报',
          },
          {
            type: 'tool-task',
            toolCallId: 'task-1',
            state: 'output-available',
            output: { background: true, task_id: 'bg-1' },
          },
        ],
      },
    ] as UIMessage[];

    requestFrontendToolContinuation(controller, () => {
      void tryContinueFrontendToolChat({
        controller,
        getStatus: () => 'ready',
        getMessages: () => messages,
        stopStream: () => undefined,
        sendMessage: async () => {
          sendCount += 1;
        },
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(sendCount, 0);
  });

  it('does NOT client-continue for a pure-text "please wait" turn', async () => {
    let sendCount = 0;
    const controller = createFrontendToolContinuationController();
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: '正在等待智能体完成。' }],
      },
    ] as UIMessage[];

    requestFrontendToolContinuation(controller, () => {
      void tryContinueFrontendToolChat({
        controller,
        getStatus: () => 'streaming',
        getMessages: () => messages,
        stopStream: () => undefined,
        ensureStopped: () => undefined,
        sendMessage: async () => {
          sendCount += 1;
        },
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(sendCount, 0);
  });

  it('gives up after MAX_CONTINUE_FAILURES so retries cannot busy-loop', async () => {
    let sendCount = 0;
    const controller = createFrontendToolContinuationController();
    const messages = answeredFirstRoundAskMessage();

    const args = {
      controller,
      getStatus: () => 'ready' as const,
      getMessages: () => messages,
      stopStream: () => undefined,
      sendMessage: async () => {
        sendCount += 1;
        throw new Error('send failed');
      },
      lastError: { current: null as unknown },
    };

    requestFrontendToolContinuation(controller, () => {
      void tryContinueFrontendToolChat(args);
    });

    // Poll until the failure cap is hit (exponential backoff totals ~3.75s).
    const deadline = Date.now() + 8000;
    while (
      controller.failureAttempts < MAX_CONTINUE_FAILURES &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(sendCount, MAX_CONTINUE_FAILURES);
    assert.equal(controller.pending, false);
  });

  it('does NOT client-continue after a provider-executed web_fetch (server resumes natively)', async () => {
    let sendCount = 0;
    const controller = createFrontendToolContinuationController();
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-web_fetch',
            toolCallId: 'wf-1',
            state: 'output-available',
            providerExecuted: true,
            output: { result: 'AI news summary', code: 200, durationMs: 800 },
          },
        ],
      },
    ] as UIMessage[];

    requestFrontendToolContinuation(controller, () => {
      void tryContinueFrontendToolChat({
        controller,
        getStatus: () => 'ready',
        getMessages: () => messages,
        stopStream: () => undefined,
        sendMessage: async () => {
          sendCount += 1;
        },
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(sendCount, 0);
  });

  it('resetFrontendToolContinuationController clears pending continuation', () => {
    const controller = createFrontendToolContinuationController();
    controller.pending = true;
    controller.continuing = true;
    controller.sendStarted = true;
    resetFrontendToolContinuationController(controller);
    assert.equal(controller.pending, false);
    assert.equal(controller.continuing, false);
    assert.equal(controller.sendStarted, false);
  });

  it('toolContinuationFingerprint changes when tool output arrives', () => {
    const before = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-web_fetch',
            toolCallId: 'wf-1',
            state: 'input-available',
            providerExecuted: true,
          },
        ],
      },
    ] as UIMessage[];
    const after = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-web_fetch',
            toolCallId: 'wf-1',
            state: 'output-available',
            providerExecuted: true,
            output: { content: 'page' },
          },
        ],
      },
    ] as UIMessage[];

    const fp1 = toolContinuationFingerprint(before);
    const fp2 = toolContinuationFingerprint(after);
    assert.notEqual(fp1, fp2);
  });

  it('requestFrontendToolContinuation returns false when already pending', () => {
    const controller = createFrontendToolContinuationController();
    controller.pending = true;
    let ran = false;
    assert.equal(
      requestFrontendToolContinuation(controller, () => {
        ran = true;
      }),
      false,
    );
    assert.equal(ran, false);
  });

  it('unmarkToolContinuationAttempt clears matching fingerprint only', () => {
    const tracker = createToolContinuationAttemptTracker();
    markToolContinuationAttempt(tracker, 'a1|tool');
    unmarkToolContinuationAttempt(tracker, 'a1|tool');
    assert.equal(tracker.lastFingerprint, null);
    assert.equal(markToolContinuationAttempt(tracker, 'a1|tool'), true);
  });

  it('markToolContinuationAttempt dedupes identical fingerprints', () => {
    const tracker = createToolContinuationAttemptTracker();
    assert.equal(markToolContinuationAttempt(tracker, 'a1|tool'), true);
    assert.equal(markToolContinuationAttempt(tracker, 'a1|tool'), false);
    resetToolContinuationAttemptTracker(tracker);
    assert.equal(markToolContinuationAttempt(tracker, 'a1|tool'), true);
  });
});
