/**
 * 对话结晶成工作流草案 —— 三分的判据。
 *
 * 最要紧的一条:**结论不能进步骤**。从一次对话里提炼出的东西是长在那次数据上的,
 * "金工分厂是瓶颈"是结论;当成步骤写进去,换个时间重放会照样跑出结果 ——
 * 看起来在工作,但答案是错的。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CRYSTALLIZE_SYSTEM_PROMPT,
  conversationToPrompt,
  crystallizedDraftSchema,
  draftToWorkflowInput,
} from './workflow-crystallize.js';

const draft = {
  name: '找瓶颈',
  steps: [{ title: '查产能证据' }, { title: '找鼓点', detail: '按负荷排序' }],
  values: [
    { label: '资源', value: '金工分厂', varies: true, why: '每次问的资源不同' },
    { label: '口径', value: 'p10', varies: false },
  ],
  findings: ['金工分厂 K=25 实测 41,是瓶颈'],
};

describe('草案形状', () => {
  it('至少要有一步 —— 零步的"工作流"不是工作流', () => {
    assert.equal(crystallizedDraftSchema.safeParse({ ...draft, steps: [] }).success, false);
  });

  it('values 和 findings 可以为空(不是每段对话都有)', () => {
    const r = crystallizedDraftSchema.safeParse({ name: 'x', steps: [{ title: 'a' }] });
    assert.equal(r.success, true);
    if (r.success) assert.deepEqual([r.data.values, r.data.findings], [[], []]);
  });
});

describe('草案 → 工作流', () => {
  it('**结论不进步骤** —— 这是整件事最容易出错的一格', () => {
    const out = draftToWorkflowInput(draft);
    assert.equal(out.steps.length, 2);
    assert.ok(!out.steps.some((s) => s.includes('瓶颈')), '结论混进步骤了');
  });

  it('结论进说明,但**标明它只是上次的样子**,不是应该得出的答案', () => {
    const out = draftToWorkflowInput(draft);
    assert.match(out.description, /上次跑出来的结论/);
    assert.match(out.description, /不是这个工作流应该得出的答案/);
  });

  it('会变的值列成"每次要确认",不变的列成固定参数 —— 两者不能混', () => {
    const out = draftToWorkflowInput(draft);
    assert.match(out.description, /固定参数:口径=p10/);
    assert.match(out.description, /每次要确认:资源/);
    assert.ok(!/固定参数[^\n]*资源/.test(out.description), '会变的值不能写成固定参数');
  });

  it('步骤带细节时一并带上 —— 只留标题会丢掉"怎么做"', () => {
    assert.match(draftToWorkflowInput(draft).steps[1]!, /按负荷排序/);
  });
});

describe('对话转输入', () => {
  it('过长的单条被截断并说明 —— 一条几万字的工具输出会把真正的意图挤出窗口', () => {
    const out = conversationToPrompt([{ role: 'assistant', content: 'x'.repeat(5000) }], 100);
    assert.ok(out.length < 400);
    assert.match(out, /截断,原长 5000/);
  });

  it('空消息跳过,不产生空段落', () => {
    const out = conversationToPrompt([
      { role: 'user', content: '找瓶颈' }, { role: 'assistant', content: '  ' },
    ]);
    assert.equal(out, '[user] 找瓶颈');
  });
});

describe('给模型的指令', () => {
  it('**拿不准就标成会变** —— 反过来会让工作流悄悄锁死在这次的数据上', () => {
    assert.match(CRYSTALLIZE_SYSTEM_PROMPT, /拿不准就填 true/);
  });

  it('明确要求场景不进 values —— 它由项目继承,不是参数', () => {
    assert.match(CRYSTALLIZE_SYSTEM_PROMPT, /场景\*\*不要\*\*放进 values|不要\*\*放进 values/);
  });
});
