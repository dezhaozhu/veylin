/**
 * 文档 ↔ 规则 对照。
 *
 * 为什么要有它:agent 刚把「粗加工 → 金工分厂」改成「锻件分厂」,而**系统里的
 * 排产规则一个字没动**。文档和系统对不上,还没人知道 —— 这比改之前更糟。
 *
 * 三条不能让步的:
 * 1. **"系统里查不到" ≠ "文档错了"。** 前者是我们不知道,后者是判断。混成一个
 *    结论,人会照着一个我们其实没核对过的东西去改。
 * 2. **不做静默模糊匹配。** 「金工分厂/外协」和「金工分厂」不是同一个值;可以
 *    报"部分对上",不能当成一致。
 * 3. **每条结论都带原文引述**,人能自己核对我们读得对不对。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { reconcile, type Assertion, type Fact } from './doc-rule-reconcile.js';

const quote = '| 粗加工 | 金工分厂 |';
const a = (over: Partial<Assertion> = {}): Assertion => ({
  kind: 'op_resource', subject: '粗加工', object: '金工分厂', quote, ...over,
});

describe('工序 → 资源', () => {
  const fact: Fact = {
    kind: 'op_resource', op: '粗加工',
    resources: [{ name: '金工分厂', share: 0.85 }, { name: '外协', share: 0.15 }],
    flexibility: 'limited',
  };

  it('对得上就是一致,并说明系统里的占比', () => {
    const [v] = reconcile([a()], [fact]);
    assert.equal(v!.status, 'agree');
    assert.match(v!.detail, /85%|0\.85/);
  });

  it('**文档说的资源系统里根本没跑过 → 冲突**,并列出系统里实际是谁', () => {
    const [v] = reconcile([a({ object: '锻件分厂' })], [fact]);
    assert.equal(v!.status, 'conflict');
    assert.match(v!.detail, /金工分厂/);
  });

  it('**部分对上不算一致** —— 「金工分厂/外协」两个都在,但文档写的是一个组合值', () => {
    const [v] = reconcile([a({ object: '金工分厂/外协' })], [fact]);
    assert.equal(v!.status, 'partial');
    assert.match(v!.detail, /金工分厂|外协/);
  });

  it('**系统里没有这道工序 → 说"查不到",不说"冲突"** —— 我们不知道 ≠ 文档错了', () => {
    const [v] = reconcile([a({ subject: '热处理' })], [fact]);
    assert.equal(v!.status, 'not_found');
    assert.match(v!.detail, /查不到|无法核对/);
    // 而且要**主动说明**这不是在指文档的错 —— 沉默会被读成"文档有问题"。
    assert.match(v!.detail, /不代表.*写错/);
  });

  it('原文引述要原样带出来 —— 人得能自己核对我们读得对不对', () => {
    const [v] = reconcile([a()], [fact]);
    assert.equal(v!.assertion.quote, quote);
  });
});

describe('产能 / 并行数', () => {
  const fact: Fact = { kind: 'capacity_k', resource: '120MN水压机', k: 1, source: '实测' };

  it('数字对得上 = 一致', () => {
    const [v] = reconcile(
      [{ kind: 'capacity_k', subject: '120MN水压机', object: '1', quote: '同时压 1 件' }],
      [fact],
    );
    assert.equal(v!.status, 'agree');
  });

  it('**数字对不上 = 冲突,而且要把两个数都说出来**', () => {
    const [v] = reconcile(
      [{ kind: 'capacity_k', subject: '120MN水压机', object: '80', quote: '可同时压 80 件' }],
      [fact],
    );
    assert.equal(v!.status, 'conflict');
    assert.match(v!.detail, /80/);
    assert.match(v!.detail, /1/);
  });

  it('不是数字的断言不硬比 —— 报"核对不了"', () => {
    const [v] = reconcile(
      [{ kind: 'capacity_k', subject: '120MN水压机', object: '很多', quote: 'x' }],
      [fact],
    );
    assert.equal(v!.status, 'unverifiable');
  });
});

describe('汇总', () => {
  it('**按"要看的"排在前面**:冲突 → 部分 → 查不到 → 一致', () => {
    const facts: Fact[] = [
      { kind: 'op_resource', op: '粗加工', resources: [{ name: '金工分厂', share: 1 }], flexibility: 'locked' },
      { kind: 'op_resource', op: '锻造', resources: [{ name: '锻件分厂', share: 1 }], flexibility: 'locked' },
    ];
    const out = reconcile(
      [a({ subject: '锻造', object: '锻件分厂' }), a({ subject: '热处理' }), a({ object: '锻件分厂' })],
      facts,
    );
    assert.deepEqual(out.map((v) => v.status), ['conflict', 'not_found', 'agree']);
  });

  it('一条断言都没有时不报空表,而是说没抽到 —— 空表会被读成"全都一致"', () => {
    assert.deepEqual(reconcile([], []), []);
  });
});

/**
 * 真数据跑出来发现的:文档说「取样 → 金工分厂」,系统里金工分厂只占 30%,
 * 主力是大锻所 70%。判成"一致"是**误导** —— 文档指的是次要的那条路,
 * 而人看到"一致"就不会再去看了。
 */
describe('对上了,但对的是次要的那个', () => {
  const fact: Fact = {
    kind: 'op_resource', op: '取样',
    resources: [{ name: '大锻所', share: 0.7 }, { name: '金工分厂', share: 0.3 }],
    flexibility: 'limited',
  };

  it('**匹配到非主力资源不能报一致** —— 要说出主力是谁', () => {
    const [v] = reconcile(
      [{ kind: 'op_resource', subject: '取样', object: '金工分厂', quote: '| 取样 | 金工分厂 |' }],
      [fact],
    );
    assert.notEqual(v!.status, 'agree');
    assert.match(v!.detail, /大锻所/);
    assert.match(v!.detail, /70%/);
  });

  it('匹配到主力资源照旧是一致', () => {
    const [v] = reconcile(
      [{ kind: 'op_resource', subject: '取样', object: '大锻所', quote: 'q' }],
      [fact],
    );
    assert.equal(v!.status, 'agree');
  });

  it('只有一个资源时它就是主力,不要因为"只有 100%"就挑刺', () => {
    const [v] = reconcile(
      [{ kind: 'op_resource', subject: '锻造', object: '锻件分厂', quote: 'q' }],
      [{ kind: 'op_resource', op: '锻造', resources: [{ name: '锻件分厂', share: 1 }], flexibility: 'locked' }],
    );
    assert.equal(v!.status, 'agree');
  });
});

/**
 * 真数据实测:上重的 11 个文档工序名里,只有 2 个和系统里的名字**一字不差**。
 * 文档说「锻造」「最终验收」,系统里是「焊后热处理」「最终检验」、还有
 * 「性能热处理」和「性能热处理-冶铸」两个变体。
 *
 * 判成"查不到"是对的(判成冲突就会一次冒出 9 条假警报)。但**光说查不到是条
 * 死胡同** —— 系统里明明有名字相近的,应该指给人看。这不是静默模糊匹配:
 * 结论仍然是"查不到",只是多给一条可查的线索。
 */
describe('查不到的时候给线索', () => {
  const facts: Fact[] = [
    { kind: 'op_resource', op: '性能热处理-冶铸', resources: [{ name: 'YZ0803-5', share: 0.45 }], flexibility: 'flexible' },
    { kind: 'op_resource', op: '最终检验', resources: [{ name: 'YZ0201-2', share: 1 }], flexibility: 'locked' },
  ];

  it('**名字相近的要点出来** —— 「性能热处理」查不到,但系统里有「性能热处理-冶铸」', () => {
    const [v] = reconcile(
      [{ kind: 'op_resource', subject: '性能热处理', object: 'x', quote: 'q' }],
      facts,
    );
    assert.equal(v!.status, 'not_found');
    assert.match(v!.detail, /性能热处理-冶铸/);
  });

  it('**给线索不等于替他认定** —— 状态照旧是查不到', () => {
    const [v] = reconcile(
      [{ kind: 'op_resource', subject: '性能热处理', object: 'YZ0803-5', quote: 'q' }],
      facts,
    );
    assert.equal(v!.status, 'not_found');
  });

  it('八竿子打不着的就别硬凑 —— 凑出来的线索会把人带偏', () => {
    const [v] = reconcile(
      [{ kind: 'op_resource', subject: '钢锭加热', object: 'x', quote: 'q' }],
      facts,
    );
    assert.equal(v!.status, 'not_found');
    assert.ok(!/性能热处理|最终检验/.test(v!.detail), `不该给线索却给了:${v!.detail}`);
  });
});
