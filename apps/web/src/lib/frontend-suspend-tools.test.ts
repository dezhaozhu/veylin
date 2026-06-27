import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UIMessage } from 'ai';
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import {
  hasAskUserAnswers,
  isAwaitingFrontendToolPart,
  isAwaitingFrontendToolAnswer,
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

  it('auto-continues after provider-executed web_fetch completes', () => {
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

    assert.equal(shouldAutoSendChat({ messages }), true);
    assert.equal(lastAssistantMessageIsCompleteWithToolCalls({ messages }), false);
  });

  it('auto-continues when web_fetch is followed by step-start only', () => {
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

    assert.equal(shouldAutoSendChat({ messages }), true);
    assert.equal(lastAssistantMessageIsCompleteWithToolCalls({ messages }), false);
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
          { type: 'text', text: 'Here is the summary.' },
        ],
      },
    ] as UIMessage[];

    assert.equal(shouldAutoSendChat({ messages }), false);
  });

  it('auto-continues server tools after step-start across tool kinds', () => {
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

    assert.equal(
      shouldAutoSendChat({
        messages: withStepStart('tool-knowledge_search', { hits: [] }),
      }),
      true,
    );
    assert.equal(
      shouldAutoSendChat({
        messages: withStepStart('tool-todo_write', { newTodos: [] }),
      }),
      true,
    );
    assert.equal(
      shouldAutoSendChat({
        messages: withStepStart('tool-tool_search', { tools: [] }),
      }),
      true,
    );
    assert.equal(
      shouldAutoSendChat({
        messages: withStepStart('tool-task', { status: 'spawned' }),
      }),
      true,
    );
    assert.equal(
      shouldAutoSendChat({
        messages: withStepStart('tool-table_get', { rows: [] }),
      }),
      true,
    );
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

});
