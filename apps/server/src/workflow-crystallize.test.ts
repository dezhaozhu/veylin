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
  draftToDefinition,
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

/**
 * 草案要变成**真能跑的**工作流,不是一段描述。
 *
 * 这里最容易糊弄过去的一格:把步骤写进 description 就交差 —— 列表里出现一个
 * 工作流,点运行什么也不做,而人以为这件事已经自动化了。
 */
describe('草案 → 能跑的节点图', () => {
  it('每一步是一个 run_agent 节点,首尾接上 start / end', () => {
    const def = draftToDefinition(draft);
    const kinds = def.nodes.map((n) => n.kind);
    assert.deepEqual(kinds, ['start', 'run_agent', 'run_agent', 'end']);
    assert.equal(def.edges.length, 3);
  });

  it('串起来的顺序就是步骤顺序 —— 每条边首尾相接', () => {
    const def = draftToDefinition(draft);
    for (const e of def.edges) {
      assert.ok(def.nodes.some((n) => n.id === e.source), `边的起点不存在: ${e.source}`);
      assert.ok(def.nodes.some((n) => n.id === e.target), `边的终点不存在: ${e.target}`);
    }
  });

  it('固定参数写进第一步的提示词 —— 否则跑起来它就丢了', () => {
    const def = draftToDefinition(draft);
    const first = String(def.nodes[1]!.data.prompt);
    assert.match(first, /口径.*p10/);
  });

  it('**会变的值不能变成一个解析成空串的占位符**', () => {
    // 今天的运行器没有"这次跑用什么参数"的入口(手动运行只给 {manual:true})。
    // 写成 {{ start.资源 }} 会在运行时插值成空字符串 —— 那一步照跑,参数没了,
    // 而且看不出来。所以带上上次的值,并要求先声明。
    const first = String(draftToDefinition(draft).nodes[1]!.data.prompt);
    assert.ok(!first.includes('{{'), '不能留占位符');
    assert.match(first, /资源/);
    assert.match(first, /金工分厂/);
    assert.match(first, /先说明|先说出来/);
  });

  it('**结论一个字都不进提示词** —— 进去就成了下次的预设答案', () => {
    for (const n of draftToDefinition(draft).nodes) {
      assert.ok(!JSON.stringify(n.data).includes('瓶颈'), `结论泄进了节点: ${n.id}`);
    }
  });
});

describe('生成的图存得进去', () => {
  it('**过 workflowInputSchema** —— 生成一个存不进去的图,失败要在这里暴露,不是在人点保存的时候', async () => {
    const { workflowInputSchema } = await import('@veylin/shared');
    const out = workflowInputSchema.safeParse({
      name: draft.name, threadId: 't1', definition: draftToDefinition(draft),
    });
    assert.equal(out.success, true, out.success ? '' : JSON.stringify(out.error.issues.slice(0, 3)));
  });
});
