import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  crystallize,
  describeDraft,
  draftBlocker,
  toggleVaries,
  upToFromMessages,
} from './workflow-crystallize.js';

const draft = {
  name: '找瓶颈',
  steps: [{ title: '查产能证据' }, { title: '找鼓点' }],
  values: [
    { label: '资源', value: '金工分厂', varies: true },
    { label: '口径', value: 'p10', varies: false },
  ],
  findings: ['金工是瓶颈'],
};

describe('能不能存', () => {
  it('**没有步骤就不能存** —— 零步的工作流跑起来什么也不做,却会出现在列表里', () => {
    assert.match(draftBlocker({ ...draft, steps: [] }) ?? '', /至少要有一步/);
  });

  it('没名字也不能存', () => {
    assert.ok(draftBlocker({ ...draft, name: '  ' }));
  });

  it('都齐了就没有拦阻', () => {
    assert.equal(draftBlocker(draft), null);
  });
});

describe('确认页那句话', () => {
  it('说清各有几项,而不是讲抽象概念', () => {
    const s = describeDraft(draft);
    assert.match(s, /2 步/);
    assert.match(s, /1 项固定/);
    assert.match(s, /1 项每次要确认/);
  });

  it('**明说结论不会带进去** —— 人能看到我们没漏,而不是以为忘了', () => {
    assert.match(describeDraft(draft), /1 条结论不会带进去/);
  });

  it('没有结论时不提这一句', () => {
    assert.doesNotMatch(describeDraft({ ...draft, findings: [] }), /结论/);
  });
});

describe('切换"下次还一样吗"', () => {
  it('只改那一项,不动别的', () => {
    const next = toggleVaries(draft, 1);
    assert.equal(next.values[1]!.varies, true);
    assert.equal(next.values[0]!.varies, true);
    assert.notEqual(next, draft);
  });
});

describe('调用', () => {
  it('失败时把服务端的话带出来 —— "没东西可结晶"和"模型出错"不是一回事', async () => {
    const impl = (async () =>
      new Response(JSON.stringify({ message: '这段对话还没有内容可以结晶' }), { status: 400 })
    ) as unknown as typeof fetch;
    const r = await crystallize('t', undefined, impl);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /没有内容可以结晶/);
  });
});

describe('从哪条消息截断', () => {
  const msgs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('截到这条为止 —— 含这条', () => {
    assert.equal(upToFromMessages(msgs, 'b'), 2);
  });

  it('第一条也能截', () => {
    // 0 会被服务端当成"没给",退回整段 —— 边界必须是 1。
    assert.equal(upToFromMessages(msgs, 'a'), 1);
  });

  it('**找不到这条消息就整段来**,不能悄悄截成半段', () => {
    // 客户端和服务端的消息列表可能对不齐。对不齐时宁可多带,不能凭一个
    // 猜出来的下标把人要的那段切掉。
    assert.equal(upToFromMessages(msgs, 'zzz'), undefined);
  });
});
