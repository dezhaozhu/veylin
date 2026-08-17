import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatTaskNotification } from './task-notification.js';
import {
  INTERRUPTED_TURN_NOTE,
  isInterruptedAssistantMessage,
  stripInterruptedAssistantTurnsForAgent,
  stripUnansweredToolCallsForAgent,
} from './interrupted-turn.js';

describe('interrupted-turn', () => {
  it('detects interrupted metadata', () => {
    assert.equal(
      isInterruptedAssistantMessage({
        role: 'assistant',
        metadata: { custom: { interrupted: true } },
      }),
      true,
    );
    assert.equal(
      isInterruptedAssistantMessage({
        role: 'assistant',
        metadata: { custom: { sentAt: 1 } },
      }),
      false,
    );
  });

  it('keeps interrupted assistant until a real user follow-up exists', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: '我先读取表格…' }],
        metadata: { custom: { interrupted: true } },
      },
    ];
    const stripped = stripInterruptedAssistantTurnsForAgent(messages);
    assert.equal((stripped[0]!.parts![0] as { text: string }).text, '我先读取表格…');
  });

  it('replaces interrupted narrative after a real user follow-up', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: '我先读取表格中的全部数据，然后派发一个子智能体。' },
          { type: 'reasoning', text: '思考中' },
        ],
        metadata: { custom: { interrupted: true, sentAt: 1 } },
      },
      {
        id: 'u2',
        role: 'user',
        parts: [{ type: 'text', text: '你好' }],
      },
    ];
    const stripped = stripInterruptedAssistantTurnsForAgent(messages);
    assert.equal(stripped.length, 2);
    assert.deepEqual(stripped[0]!.parts, [{ type: 'text', text: INTERRUPTED_TURN_NOTE }]);
    assert.equal(
      (stripped[0] as { content?: string }).content,
      INTERRUPTED_TURN_NOTE,
    );
    assert.equal((stripped[1]!.parts![0] as { text: string }).text, '你好');
  });

  it('does not treat task-notification users as follow-up for stripping', () => {
    const notification = formatTaskNotification({
      taskId: 'bg-1',
      status: 'completed',
      summary: 'done',
    });
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: '派发中…' }],
        metadata: { custom: { interrupted: true } },
      },
      {
        id: 'n1',
        role: 'user',
        parts: [{ type: 'text', text: notification }],
      },
    ];
    const stripped = stripInterruptedAssistantTurnsForAgent(messages);
    assert.equal((stripped[0]!.parts![0] as { text: string }).text, '派发中…');
  });

  it('leaves non-interrupted assistants unchanged', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: '正常回复' }],
      },
      {
        id: 'u2',
        role: 'user',
        parts: [{ type: 'text', text: '继续' }],
      },
    ];
    const stripped = stripInterruptedAssistantTurnsForAgent(messages);
    assert.equal((stripped[0]!.parts![0] as { text: string }).text, '正常回复');
  });
});

/**
 * 实测卡死的场景:agent 用 ask_user_question 问了一句(挂起),用户没点那个问题
 * 而是**直接打字回复**。之后每一轮 assistant 都只产出一个空 step —— 界面上就是
 * "我说了话,它不理我",而且永远不会自己恢复。
 *
 * 根因:那条没被回答的 tool call 一直留在历史里,后面每次调模型都带着它。
 * 上面那条 stripper 只管客户端标了 `interrupted` 的 turn,不管这种。
 */
describe('没被回答的前端工具调用', () => {
  const suspended = (id = 'a1') => ({
    id, role: 'assistant',
    parts: [
      { type: 'text', text: '我先问一下' },
      { type: 'tool-ask_user_question', toolCallId: 't1', state: 'input-available' },
      { type: 'data-tool-call-suspended', data: { runId: 'r1', toolCallId: 't1' } },
    ],
  });

  it('**用户改用打字回复之后,悬空的工具调用要摘掉**', () => {
    const out = stripUnansweredToolCallsForAgent([
      suspended(), { id: 'u2', role: 'user', parts: [{ type: 'text', text: '好了,我绑好了' }] },
    ]);
    const kinds = (out[0]!.parts ?? []).map((p) => (p as { type: string }).type);
    assert.ok(!kinds.includes('tool-ask_user_question'), `悬空调用还在:${kinds.join(',')}`);
  });

  it('**措辞不能说成"用户没回答"** —— 实测里用户点了、答案也送达了,只是没写进历史', () => {
    const out = stripUnansweredToolCallsForAgent([
      suspended(), { id: 'u2', role: 'user', parts: [{ type: 'text', text: '好了' }] },
    ]);
    const text = (out[0]!.parts ?? [])
      .filter((p): p is { type: string; text: string } => (p as { type: string }).type === 'text')
      .map((p) => p.text).join(' ');
    assert.match(text, /没有留在记录里/);
    // 说成"用户没回答"会让模型再问一遍,或者以为用户在回避 —— 而他明明答了。
    assert.ok(!/用户.*没有回答|没有被回答/.test(text), `措辞把答过说成没答:${text}`);
  });

  it('原来的正文留着 —— 那是它已经说过的话', () => {
    const out = stripUnansweredToolCallsForAgent([
      suspended(), { id: 'u2', role: 'user', parts: [{ type: 'text', text: '好了' }] },
    ]);
    assert.match(JSON.stringify(out[0]), /我先问一下/);
  });

  it('**没有后续用户消息就不动** —— 那是正常在等人回答,不是卡住', () => {
    const msgs = [suspended()];
    assert.deepEqual(stripUnansweredToolCallsForAgent(msgs), msgs);
  });

  it('已经有结果的工具调用不碰', () => {
    const done = {
      id: 'a1', role: 'assistant',
      parts: [{ type: 'tool-ask_user_question', toolCallId: 't1', state: 'output-available',
                output: { answers: {} } }],
    };
    const msgs = [done, { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'x' }] }];
    assert.deepEqual(stripUnansweredToolCallsForAgent(msgs), msgs);
  });
});
