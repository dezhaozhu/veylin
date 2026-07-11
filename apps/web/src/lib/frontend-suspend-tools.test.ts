import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UIMessage } from 'ai';
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import {
  conversationAwaitsResume,
  hasAskUserAnswers,
  hasFrontendToolOutput,
  isAwaitingFrontendToolPart,
  isAwaitingFrontendToolAnswer,
  registerFrontendToolStop,
  shouldAutoSendChat,
  trimAssistantAfterAwaitingTool,
  waitForFrontendToolStop,
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

  it('does not suspend while tool args are still streaming', () => {
    assert.equal(
      isAwaitingFrontendToolPart({
        type: 'tool-ask_user_question',
        state: 'input-streaming',
      }),
      false,
    );
    assert.equal(
      isAwaitingFrontendToolPart({
        type: 'tool-ask_user_question',
        state: 'input-available',
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

  it('auto-continues after provider-executed ask_user_question is answered on the client', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Let me ask you a few questions.' },
          {
            type: 'tool-ask_user_question',
            state: 'output-available',
            providerExecuted: true,
            output: {
              answers: { 'Pick one?': 'A' },
              questions: [{ question: 'Pick one?', header: 'Pick', options: [{ label: 'A' }] }],
            },
          },
        ],
      },
    ] as UIMessage[];

    assert.equal(shouldAutoSendChat({ messages }), true);
    assert.equal(lastAssistantMessageIsCompleteWithToolCalls({ messages }), false);
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

  it('isAwaitingFrontendToolAnswer when ask panel is open', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'tool-ask_user_question', state: 'input-available' }],
      },
    ] as UIMessage[];
    assert.equal(isAwaitingFrontendToolAnswer(messages), true);
  });

  it('isAwaitingFrontendToolAnswer is false after answers are filled', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-ask_user_question',
            state: 'output-available',
            output: { answers: { Q: 'A' } },
          },
        ],
      },
    ] as UIMessage[];
    assert.equal(isAwaitingFrontendToolAnswer(messages), false);
  });

  it('does NOT client-continue after a provider-executed web_fetch (server resumes natively)', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Let me fetch the page.' },
          {
            type: 'tool-web_fetch',
            state: 'output-available',
            providerExecuted: true,
            output: { result: 'page summary', code: 200 },
          },
        ],
      },
    ] as UIMessage[];

    assert.equal(shouldAutoSendChat({ messages }), false);
    assert.equal(lastAssistantMessageIsCompleteWithToolCalls({ messages }), false);
  });

  it('does NOT client-continue when web_fetch is followed by step-start only', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Fetching…' },
          {
            type: 'tool-web_fetch',
            state: 'output-available',
            providerExecuted: true,
            output: { result: 'page summary', code: 200 },
          },
          { type: 'step-start' },
        ],
      },
    ] as UIMessage[];

    assert.equal(shouldAutoSendChat({ messages }), false);
  });

  it('does NOT client-continue a provider-executed web_fetch stuck at input-available', () => {
    // The server owns this tool; if its stream is alive it finishes it, and if the
    // connection dropped, resumable GET resume recovers it. A client re-POST would
    // restart the whole turn.
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-web_fetch',
            toolCallId: 'wf-1',
            state: 'input-available',
            providerExecuted: true,
            input: { url: 'https://example.com', prompt: 'summarize' },
          },
        ],
      },
    ] as UIMessage[];

    assert.equal(shouldAutoSendChat({ messages }), false);
    assert.equal(shouldAutoSendChat({ messages, status: 'streaming' }), false);
    assert.equal(shouldAutoSendChat({ messages, status: 'submitted' }), false);
  });

  it('does not auto-continue when provider tools end with assistant text', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-web_fetch',
            state: 'output-available',
            providerExecuted: true,
            output: { result: 'page summary', code: 200 },
          },
          { type: 'step-start' },
          { type: 'text', text: 'Here is the summary.' },
        ],
      },
    ] as UIMessage[];

    assert.equal(shouldAutoSendChat({ messages }), false);
  });

  it('does NOT client-continue server tools after step-start across tool kinds', () => {
    // Server-executed tools complete inside the server agent loop; the client must
    // not re-POST for them (that would restart the turn and loop the model).
    const withStepStart = (toolType: string, output: unknown) =>
      [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: toolType,
              state: 'output-available',
              providerExecuted: true,
              output,
            },
            { type: 'step-start' },
          ],
        },
      ] as UIMessage[];

    for (const toolType of [
      'tool-knowledge_search',
      'tool-todo_write',
      'tool-tool_search',
      'tool-task',
      'tool-table_get',
    ]) {
      assert.equal(
        shouldAutoSendChat({ messages: withStepStart(toolType, {}) }),
        false,
        `${toolType} must not client-continue`,
      );
    }
  });

  it('auto-continues answered ask_user_question after step-start', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-ask_user_question',
            state: 'output-available',
            providerExecuted: true,
            output: { answers: { Q: 'A' } },
          },
          { type: 'step-start' },
        ],
      },
    ] as UIMessage[];

    assert.equal(shouldAutoSendChat({ messages }), true);
  });

  it('auto-continues read_open_page after client result and step-start', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-read_open_page',
            state: 'output-available',
            providerExecuted: true,
            output: { content: 'page body', url: 'https://intranet/' },
          },
          { type: 'step-start' },
        ],
      },
    ] as UIMessage[];

    assert.equal(shouldAutoSendChat({ messages }), true);
  });

  it('treats empty-page read_open_page output as complete', () => {
    assert.equal(
      hasFrontendToolOutput('read_open_page', {
        mode: 'text',
        url: 'about:blank',
        title: '',
        content: '',
      }),
      true,
    );
    assert.equal(hasFrontendToolOutput('read_open_page', { error: 'no webview' }), true);
    assert.equal(hasFrontendToolOutput('read_open_page', {}), false);
  });

  it('does not auto-continue while approval is pending', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-table_set_cell',
            state: 'approval-requested',
            approval: { id: 'ap-1' },
          },
        ],
      },
    ] as UIMessage[];

    assert.equal(shouldAutoSendChat({ messages }), false);
  });

  it('does not auto-continue while read_open_page is still running on the client', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'tool-read_open_page', state: 'input-available' }],
      },
    ] as UIMessage[];

    assert.equal(shouldAutoSendChat({ messages }), false);
    assert.equal(isAwaitingFrontendToolAnswer(messages), true);
  });

  it('conversationAwaitsResume is false for a finished assistant reply', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '读取表格并分析' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-task',
            state: 'output-available',
            providerExecuted: true,
            output: { summary: 'analysis', background: false },
          },
          { type: 'step-start' },
          { type: 'text', text: '下面是完整的分析报告。' },
        ],
      },
    ] as UIMessage[];
    // A completed reply must never be resumed on refresh, even if the server still
    // reports the thread as "running" (stale stream mapping / orphaned task row).
    assert.equal(conversationAwaitsResume(messages), false);
  });

  it('conversationAwaitsResume is true while a turn is genuinely mid-flight', () => {
    const pendingUser = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    ] as UIMessage[];
    assert.equal(conversationAwaitsResume(pendingUser), true);

    const toolPending = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'fetch' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-web_fetch',
            toolCallId: 'wf-1',
            state: 'input-available',
            providerExecuted: true,
            input: { url: 'https://example.com' },
          },
        ],
      },
    ] as UIMessage[];
    assert.equal(conversationAwaitsResume(toolPending), true);

    const emptyAssistant = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [] },
    ] as UIMessage[];
    assert.equal(conversationAwaitsResume(emptyAssistant), true);

    const awaitingAnswer = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'tool-ask_user_question', state: 'input-available' }],
      },
    ] as UIMessage[];
    assert.equal(conversationAwaitsResume(awaitingAnswer), true);
  });

  it('waitForFrontendToolStop resolves after the registered stop promise', async () => {
    let resolveStop!: () => void;
    const stopPromise = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    registerFrontendToolStop('ask-1', stopPromise);

    let settled = false;
    const waiting = waitForFrontendToolStop('ask-1').then(() => {
      settled = true;
    });

    await Promise.resolve();
    assert.equal(settled, false);

    resolveStop();
    await waiting;
    assert.equal(settled, true);
  });

  it('does not auto-continue after background task dispatch — synthesis handles it', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: '正在等待各子智能体返回结果，稍后会汇总汇报',
          },
          {
            type: 'tool-task',
            toolCallId: 'task-1',
            state: 'output-available',
            output: { background: true, task_id: 'bg-abc' },
          },
        ],
      },
    ] as UIMessage[];
    assert.equal(shouldAutoSendChat({ messages, status: 'ready' }), false);
  });

});
