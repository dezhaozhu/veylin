/**
 * 真 LibSQL 契约:假 memory 证不了的两件事。
 *
 * 一、运行时的 Memory 是 `readOnly: true` 建的 —— 那面旗到底挡不挡 `updateMessages`?
 *     挡的话这个修复会**一声不响地什么都没做**,而所有单元测试照样绿。
 * 二、存进去的 `content` 形状(format/parts、原有的 `input`、createdAt)在这条
 *     更新路径上是不是原样留着。
 *
 * 这一条是拿一次性脚本探出来的,探完就该留下 —— 同一类"形状对不上、静默失效"
 * 的坑今天已经踩过一次(compass 的 rows/eligibility)。
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';

import { persistAskAnswer } from './ask-answer-record.js';

const dir = mkdtempSync(join(tmpdir(), 'ask-persist-'));
after(() => rmSync(dir, { recursive: true, force: true }));

describe('persistAskAnswer(真 LibSQL)', () => {
  it('**readOnly 的 Memory 也真写得进去**,且不动 input / createdAt', async () => {
    const memory = new Memory({
      storage: new LibSQLStore({ id: 'ask-persist', url: `file:${join(dir, 'm.db')}` }),
      // 与 packages/runtime/src/memory.ts 一致:readOnly 是运行时的真实姿态。
      options: { readOnly: true, lastMessages: 50, semanticRecall: false,
                 workingMemory: { enabled: false } },
    });
    const threadId = 'th1';
    const resourceId = 'res1';
    await memory.saveThread({ thread: { id: threadId, resourceId, title: 't',
      createdAt: new Date(), updatedAt: new Date(), metadata: {} } as never });
    await memory.saveMessages({ messages: [
      { id: 'u1', role: 'user', threadId, resourceId, createdAt: new Date(1_700_000_000_000),
        content: { format: 2, parts: [{ type: 'text', text: '改一下' }] } },
      { id: 'a1', role: 'assistant', threadId, resourceId, createdAt: new Date(1_700_000_000_001),
        content: { format: 2, parts: [
          { type: 'text', text: '我先问一下' },
          { type: 'tool-ask_user_question', toolCallId: 't1', state: 'input-available',
            input: { questions: [{ question: '范围?' }] } },
        ] } },
    ] as never });

    await persistAskAnswer(
      memory as never, { threadId, resourceId }, 't1', { answers: { 范围: '只改文档' } },
    );

    const back = await memory.recall({ threadId, resourceId, perPage: false } as never);
    const a1 = (back.messages ?? []).find((m) => (m as { id?: string }).id === 'a1') as {
      createdAt?: Date; content?: { parts?: Array<Record<string, unknown>> };
    };
    const part = (a1.content?.parts ?? []).find((p) => p.toolCallId === 't1')!;

    assert.equal(part.state, 'output-available', 'readOnly 把写挡掉了 —— 修复会静默失效');
    assert.deepEqual(part.output, { answers: { 范围: '只改文档' } });
    // 问题本身还得在:没了它,历史上就只剩一个没有来由的答案。
    assert.deepEqual(part.input, { questions: [{ question: '范围?' }] });
    assert.equal(new Date(a1.createdAt!).getTime(), 1_700_000_000_001, '时间戳被改写 —— 消息会跳位');
  });
});
