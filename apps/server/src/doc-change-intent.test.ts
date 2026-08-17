/**
 * 改文档之前那一问:**你要改的是这份文档,还是它描述的那件事?**
 *
 * 起因很具体(A 第 1 步就是为了它):agent 把文档里「粗加工 → 金工分厂」改成
 * 「锻件分厂」,而系统里的排产规则一个字没动。文档和系统对不上,两边看起来都
 * 正常 —— 比改之前更糟。
 *
 * 这一问不是礼貌用语,是**基于对照结果**的:先看这条要改的东西在系统里是什么,
 * 再把选项摆出来。所以判据是确定性的,不靠模型临场发挥。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { changeIntent } from './doc-change-intent.js';
import type { Verdict } from './doc-rule-reconcile.js';

const v = (over: Partial<Verdict> = {}): Verdict => ({
  assertion: { kind: 'op_resource', subject: '粗加工', object: '金工分厂', quote: '| 粗加工 | 金工分厂 |' },
  status: 'agree',
  detail: '一致:系统里 92% 跑在金工分厂。',
  ...over,
});

describe('要不要问', () => {
  it('**改的这句和系统一致 → 必须问**:改完文档,系统就和文档对不上了', () => {
    const out = changeIntent('| 粗加工 | 金工分厂 |', [v()]);
    assert.equal(out.ask, true);
    assert.match(out.question, /这份文档|那件事/);
  });

  it('**本来就不一致 → 也要问**,而且要说这次改是"让文档跟上系统"还是相反', () => {
    const out = changeIntent('| 粗加工 | 金工分厂 |', [v({ status: 'conflict', detail: '系统里是锻件分厂' })]);
    assert.equal(out.ask, true);
    assert.match(out.question, /本来就.*对不上|仍然不一致/);
  });

  it('**系统里查不到这条 → 不问**:没有"那件事"可改,问了是空转', () => {
    assert.equal(changeIntent('| 粗加工 | 金工分厂 |', [v({ status: 'not_found' })]).ask, false);
  });

  it('要改的那句压根不在对照结果里 → 不问', () => {
    assert.equal(changeIntent('随便一句话', [v()]).ask, false);
  });

  it('没有对照结果 → 不问(还没对照过,不能假装知道)', () => {
    assert.equal(changeIntent('| 粗加工 | 金工分厂 |', []).ask, false);
  });
});

describe('问题本身', () => {
  it('**给的是两个具体动作,不是"你确定吗"**', () => {
    const out = changeIntent('| 粗加工 | 金工分厂 |', [v()]);
    assert.equal(out.options?.length, 2);
    assert.ok(out.options!.some((o) => /只改文档/.test(o)));
    assert.ok(out.options!.some((o) => /规则|系统/.test(o)));
  });

  it('把系统里的事实原样带上 —— 人要据此判断,不能让他自己再查一遍', () => {
    const out = changeIntent('| 粗加工 | 金工分厂 |', [v()]);
    assert.match(out.question, /92%|金工分厂/);
  });

  it('引述要能对上原文 —— 人得知道我们说的是哪一句', () => {
    const out = changeIntent('| 粗加工 | 金工分厂 |', [v()]);
    assert.match(out.question, /粗加工/);
  });
});
