/**
 * 从文档里抽出**可核对的断言**。模型提名,代码判定 —— 这里钉的是"提名出来的
 * 东西必须能被核对",不是钉模型说了什么。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertionSchema, factsFromCompass, ASSERTION_PROMPT } from './doc-assertions.js';

describe('断言的形状', () => {
  it('合法断言过', () => {
    const r = assertionSchema.safeParse({
      assertions: [{ kind: 'op_resource', subject: '粗加工', object: '金工分厂', quote: '| 粗加工 | 金工分厂 |' }],
    });
    assert.equal(r.success, true);
  });

  it('**没有原文引述的断言不收** —— 核对结论必须能追回文档里那一句', () => {
    const r = assertionSchema.safeParse({
      assertions: [{ kind: 'op_resource', subject: '粗加工', object: '金工分厂' }],
    });
    assert.equal(r.success, false);
  });

  it('认不出的类型不收 —— 收了也核对不了,只会变成一堆"无法核对"', () => {
    const r = assertionSchema.safeParse({
      assertions: [{ kind: '随便什么', subject: 'a', object: 'b', quote: 'q' }],
    });
    assert.equal(r.success, false);
  });
});

describe('提示词', () => {
  it('**明说只抽能核对的两类**,别的不要 —— 不然模型会把整篇文章拆成断言', () => {
    assert.match(ASSERTION_PROMPT, /op_resource/);
    assert.match(ASSERTION_PROMPT, /capacity_k/);
    assert.match(ASSERTION_PROMPT, /原文|quote/);
  });

  it('**要求宁缺勿滥** —— 编出来的断言会变成假冲突,比漏掉更坏', () => {
    assert.match(ASSERTION_PROMPT, /不确定|拿不准|宁可/);
  });
});

describe('factsFromCompass —— 把工具回参翻成事实', () => {
  it('资格视图 → op_resource 事实', () => {
    const facts = factsFromCompass({
      eligibility: [
        { op_code: '粗加工', equipment: [{ name: '金工分厂', share: 0.85 }], flexibility: 'limited' },
      ],
    });
    assert.equal(facts[0]!.kind, 'op_resource');
    if (facts[0]!.kind === 'op_resource') assert.equal(facts[0]!.resources[0]!.name, '金工分厂');
  });

  it('资源清单 → capacity_k 事实', () => {
    const facts = factsFromCompass({
      resources: [{ name: '120MN水压机', k: 1, source: '实测' }],
    });
    assert.equal(facts[0]!.kind, 'capacity_k');
  });

  it('**回参缺字段时跳过那一条,不造一个 k=0 的事实** —— 假事实会比出假冲突', () => {
    const facts = factsFromCompass({ resources: [{ name: '无 K 的资源' } as never] });
    assert.equal(facts.length, 0);
  });

  it('什么都没有就是空,不炸', () => {
    assert.deepEqual(factsFromCompass({}), []);
  });
});

describe('summarizeReconcile —— 报给人的那句话', () => {
  it('**冲突数打头** —— 人第一眼要看到的是"有几条对不上"', async () => {
    const { summarizeReconcile } = await import('./doc-assertions.js');
    const s = summarizeReconcile([
      { assertion: { kind: 'op_resource', subject: 'a', object: 'b', quote: 'q' }, status: 'conflict', detail: 'd' },
      { assertion: { kind: 'op_resource', subject: 'c', object: 'd', quote: 'q' }, status: 'agree', detail: 'd' },
    ]);
    assert.match(s, /^1 条对不上/);
  });

  it('**全一致也要说清核对了几条** —— 只说"没问题"分不出"都对"和"没抽到断言"', async () => {
    const { summarizeReconcile } = await import('./doc-assertions.js');
    assert.match(summarizeReconcile([
      { assertion: { kind: 'op_resource', subject: 'a', object: 'b', quote: 'q' }, status: 'agree', detail: 'd' },
    ]), /核对了 1 条/);
  });

  it('一条都没抽到时说"没抽到可核对的断言",不说"一致"', async () => {
    const { summarizeReconcile } = await import('./doc-assertions.js');
    assert.match(summarizeReconcile([]), /没有抽到/);
  });

  it('查不到的单独说 —— 它既不是一致也不是冲突', async () => {
    const { summarizeReconcile } = await import('./doc-assertions.js');
    assert.match(summarizeReconcile([
      { assertion: { kind: 'op_resource', subject: 'a', object: 'b', quote: 'q' }, status: 'not_found', detail: 'd' },
    ]), /1 条查不到|无法核对/);
  });
});

/**
 * 真模型跑出来的两件事(实测):
 * - 它用了 `type` 而不是 `kind` —— 因为提示词从没**给过 JSON 的样子**。
 * - 14 条里只要有 1 条不合规,整批被 schema 拒掉 —— 过严,等于白跑一次。
 */
describe('提名结果的容错', () => {
  it('**提示词里必须有 JSON 例子** —— 只说字段名,模型会自己发明键名(实测踩到)', () => {
    assert.match(ASSERTION_PROMPT, /"kind"/);
    assert.match(ASSERTION_PROMPT, /"quote"/);
    assert.match(ASSERTION_PROMPT, /\{/);
  });

  it('`type` 当 `kind` 的别名收下 —— 内容是对的,不该因为键名丢掉 14 条', async () => {
    const { parseAssertions } = await import('./doc-assertions.js');
    const out = parseAssertions({
      assertions: [{ type: 'op_resource', subject: '锻造', object: '锻件分厂', quote: 'q' }],
    });
    assert.equal(out.assertions.length, 1);
    assert.equal(out.assertions[0]!.kind, 'op_resource');
  });

  it('**坏行单独丢掉,好行留下,并说丢了几条** —— 一条坏行不该毁掉整批', async () => {
    const { parseAssertions } = await import('./doc-assertions.js');
    const out = parseAssertions({
      assertions: [
        { kind: 'op_resource', subject: 'a', object: 'b', quote: 'q' },
        { kind: '瞎编的', subject: 'c', object: 'd', quote: 'q' },
        { kind: 'capacity_k', subject: 'e', quote: 'q' },
      ],
    });
    assert.equal(out.assertions.length, 1);
    assert.equal(out.dropped, 2);
  });

  it('全是坏行时 dropped 说实话,不假装抽到了东西', async () => {
    const { parseAssertions } = await import('./doc-assertions.js');
    const out = parseAssertions({ assertions: [{ kind: 'x' }, {}] });
    assert.equal(out.assertions.length, 0);
    assert.equal(out.dropped, 2);
  });
});

/**
 * 对接 compass 的真实回参形状。
 *
 * compass 那边字段叫 `resource`(它的领域词),我这边一开始只读 `name` ——
 * 两边各自都"对",接起来一条事实也认不出来。这种错不会有任何报错。
 */
describe('认 compass 的真实字段名', () => {
  it('**equipment[].resource 要认** —— compass 的 op_eligibility 就是这么回的', async () => {
    const { factsFromCompass } = await import('./doc-assertions.js');
    const facts = factsFromCompass({
      eligibility: [{
        op_code: '粗加工', flexibility: 'limited',
        equipment: [{ resource: '金工分厂', count: 3, share: 0.75 }],
      }] as never,
    });
    assert.equal(facts.length, 1);
    if (facts[0]!.kind === 'op_resource') assert.equal(facts[0]!.resources[0]!.name, '金工分厂');
  });

  it('rows 也认 —— 工具回的是 { rows: [...] } 而不是 { eligibility: [...] }', async () => {
    const { factsFromCompass } = await import('./doc-assertions.js');
    const facts = factsFromCompass({
      rows: [{ op_code: '锻造', flexibility: 'locked', equipment: [{ resource: '锻件分厂', share: 1 }] }],
    } as never);
    assert.equal(facts.length, 1);
  });

  it('op_name 也能当 key —— 文档里写的是名字,库里存的可能是代号', async () => {
    const { factsFromCompass } = await import('./doc-assertions.js');
    const facts = factsFromCompass({
      rows: [{ op_code: 'CJ1', op_name: '粗加工', flexibility: 'locked', equipment: [{ resource: '金工分厂', share: 1 }] }],
    } as never);
    assert.equal(facts.length, 2, '代号和名称应各出一条事实,两种写法都对得上');
  });
});
