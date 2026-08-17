/**
 * 把用户对 ask_user_question 的回答**写回历史**。
 *
 * 实测的缺口:`resume.resumeData` 直接进 `resumeStream`,从来不落库。于是历史里那个
 * 工具调用**永远是"未回答"的样子**,而事实是答过了 —— 后面每一轮 agent 都不知道
 * 用户当时选了什么。今天靠"摘掉悬空调用"绕过去,那是绕过不是解决。
 *
 * 三条:
 * 1. **写进那个部件本身**,不另起一条消息 —— 答案是这次调用的结果,不是一句新发言。
 * 2. **只动对得上 toolCallId 的那一个**:一条消息里可能有好几个工具调用。
 * 3. **已经有结果的不覆盖** —— 重复 resume 不该把先前的答案改掉。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { recordAskAnswer } from './ask-answer-record.js';

const msgs = () => [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: '改一下' }] },
  {
    id: 'a1', role: 'assistant',
    parts: [
      { type: 'text', text: '我先问一下' },
      { type: 'tool-ask_user_question', toolCallId: 't1', state: 'input-available' },
      { type: 'tool-other', toolCallId: 't2', state: 'input-available' },
      { type: 'data-tool-call-suspended', data: { runId: 'r1', toolCallId: 't1' } },
    ],
  },
];

describe('recordAskAnswer', () => {
  it('**答案写进那个部件**,状态变成有结果', () => {
    const out = recordAskAnswer(msgs(), 't1', { answers: { 范围: '只改文档' } });
    const part = (out[1]!.parts as Array<Record<string, unknown>>)
      .find((p) => p.toolCallId === 't1')!;
    assert.equal(part.state, 'output-available');
    assert.deepEqual(part.output, { answers: { 范围: '只改文档' } });
  });

  it('**挂起标记一并清掉** —— 它记的是"还在等",而现在不等了', () => {
    const out = recordAskAnswer(msgs(), 't1', { answers: {} });
    const kinds = (out[1]!.parts as Array<{ type: string }>).map((p) => p.type);
    assert.ok(!kinds.includes('data-tool-call-suspended'));
  });

  it('**同一条消息里别的工具调用不动**', () => {
    const out = recordAskAnswer(msgs(), 't1', { answers: {} });
    const other = (out[1]!.parts as Array<Record<string, unknown>>)
      .find((p) => p.toolCallId === 't2')!;
    assert.equal(other.state, 'input-available');
  });

  it('**已经有结果的不覆盖** —— 重复 resume 不该改掉先前的答案', () => {
    const already = [{
      id: 'a1', role: 'assistant',
      parts: [{ type: 'tool-ask_user_question', toolCallId: 't1',
                state: 'output-available', output: { answers: { a: '先前的' } } }],
    }];
    const out = recordAskAnswer(already, 't1', { answers: { a: '后来的' } });
    assert.deepEqual(
      (out[0]!.parts as Array<Record<string, unknown>>)[0]!.output,
      { answers: { a: '先前的' } },
    );
  });

  it('对不上 toolCallId 时原样返回 —— 不瞎写', () => {
    const m = msgs();
    assert.deepEqual(recordAskAnswer(m, '不存在', { answers: {} }), m);
  });

  it('空答案也算答案(用户选了跳过)—— 不能当成没答', () => {
    const out = recordAskAnswer(msgs(), 't1', { answers: {} });
    const part = (out[1]!.parts as Array<Record<string, unknown>>).find((p) => p.toolCallId === 't1')!;
    assert.equal(part.state, 'output-available');
  });
});

/**
 * 落库那一半。刀口选 `updateMessages` 而不是"整条线程删了重存":
 * 只碰那一条、保住原始时间戳,失败了也不会把整段历史带走。
 */
import { persistAskAnswer } from './ask-answer-record.js';

function fakeMemory(stored: Array<Record<string, unknown>>) {
  const updates: Array<{ id: string; content: { parts: unknown[] } }> = [];
  return {
    updates,
    memory: {
      recall: async () => ({ messages: stored }),
      updateMessages: async ({ messages }: { messages: typeof updates }) => {
        updates.push(...messages);
        return [];
      },
    } as never,
  };
}

const storedThread = () => [
  { id: 'u1', role: 'user', content: { format: 2, parts: [{ type: 'text', text: '改一下' }] } },
  {
    id: 'a1', role: 'assistant',
    content: {
      format: 2,
      parts: [
        { type: 'text', text: '我先问一下' },
        { type: 'tool-ask_user_question', toolCallId: 't1', state: 'input-available' },
      ],
    },
  },
];

describe('persistAskAnswer', () => {
  const identity = { threadId: 'th1', resourceId: 'u' };

  it('**答案落到那条消息上**', async () => {
    const { memory, updates } = fakeMemory(storedThread());
    await persistAskAnswer(memory, identity, 't1', { answers: { 范围: '只改文档' } });
    assert.equal(updates.length, 1);
    assert.equal(updates[0]!.id, 'a1');
    const part = updates[0]!.content.parts.find(
      (p) => (p as { toolCallId?: string }).toolCallId === 't1',
    ) as Record<string, unknown>;
    assert.equal(part.state, 'output-available');
    assert.deepEqual(part.output, { answers: { 范围: '只改文档' } });
  });

  it('**只改这一条** —— 别的消息不进 update', async () => {
    const { memory, updates } = fakeMemory(storedThread());
    await persistAskAnswer(memory, identity, 't1', { answers: {} });
    assert.deepEqual(updates.map((u) => u.id), ['a1']);
  });

  it('**没什么可改就一次写都不发** —— 重复 resume 不该反复动库', async () => {
    const done = storedThread();
    (done[1]!.content as { parts: Array<Record<string, unknown>> }).parts[1] = {
      type: 'tool-ask_user_question', toolCallId: 't1',
      state: 'output-available', output: { answers: {} },
    };
    const { memory, updates } = fakeMemory(done);
    await persistAskAnswer(memory, identity, 't1', { answers: { a: '后来的' } });
    assert.equal(updates.length, 0);
  });

  it('**落库失败不能把这次 resume 弄挂** —— 答案没写进历史是遗憾,答不上话是事故', async () => {
    const memory = {
      recall: async () => ({ messages: storedThread() }),
      updateMessages: async () => { throw new Error('store down'); },
    } as never;
    await persistAskAnswer(memory, identity, 't1', { answers: {} });
  });

  it('取不到历史时静默走开', async () => {
    const memory = { recall: async () => { throw new Error('nope'); } } as never;
    await persistAskAnswer(memory, identity, 't1', { answers: {} });
  });
});
