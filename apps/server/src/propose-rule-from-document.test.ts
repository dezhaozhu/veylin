/**
 * 「文档 + 规则一起改」那条路的守门。
 *
 * 这一步真的会改变排产(资格候选集是排他的),所以**宁可拒绝也不要蒙着提** ——
 * 一条不知道自己会砍掉什么的规则提案,比没有提案坏。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rememberVerdicts } from './doc-change-intent.js';
import { buildTableTools } from './table-tools.js';
import type { Verdict } from './doc-rule-reconcile.js';

const verdict: Verdict = {
  assertion: { kind: 'op_resource', subject: '粗加工', object: '锻件分厂', quote: '| 粗加工 | 锻件分厂 |' },
  status: 'conflict',
  detail: '不一致:系统里实际是 金工分厂 92%、外协 8%。',
  systemResources: ['金工分厂', '外协'],
};

let sent: Record<string, unknown> | undefined;
const toolsets = () => ({
  compass: {
    propose_rule_from_document: {
      execute: async (args: unknown) => {
        sent = args as Record<string, unknown>;
        return { ok: true, proposal_id: 'p-1', warning: '会排除 金工分厂' };
      },
    },
  },
});
// 真实的键(见 compassScopeFromCtx):项目 id 在 pinnedProjectScope.id 上
const ctx = {
  requestContext: new Map<string, unknown>([
    ['pinnedProjectScope', { id: 'proj-1', entryPin: 'compass' }],
    ['scopedMcpToolsets', toolsets()],
  ]),
} as never;

const run = (args: { name: string; quote: string }) =>
  (buildTableTools(toolsets as never, () => ({})) as never as {
    propose_rule_from_document: { execute: (a: unknown, c?: unknown) => Promise<Record<string, unknown>> };
  }).propose_rule_from_document.execute(args, ctx);

describe('提案之前的守门', () => {
  it('**没对照过 → 拒**,并说该先做什么', async () => {
    const out = await run({ name: '没对照过.docx', quote: 'x' });
    assert.equal(out.ok, false);
    assert.match(String(out.error), /reconcile_document/);
  });

  it('对照过但这一句不在结果里 → 拒', async () => {
    rememberVerdicts('proj-1', '工艺.docx', [verdict]);
    const out = await run({ name: '工艺.docx', quote: '完全无关的一句' });
    assert.equal(out.ok, false);
  });

  it('**产能类断言现在提得了了** —— 走的是另一种规则形状(见下面那一组)', async () => {
    rememberVerdicts('proj-1', 'k0.docx', [{
      assertion: { kind: 'capacity_k', subject: '120MN水压机', object: '1', quote: '同时压 1 件' },
      status: 'conflict', detail: 'x',
    }]);
    const out = await run({ name: 'k0.docx', quote: '同时压 1 件' });
    assert.equal(out.ok, true, String(out.error));
  });
});

describe('真的提上去时', () => {
  it('**把"系统里现在在用谁"传过去** —— 没有它,提案说不出自己会排除掉谁', async () => {
    rememberVerdicts('proj-1', '工艺.docx', [verdict]);
    sent = undefined;
    const out = await run({ name: '工艺.docx', quote: '| 粗加工 | 锻件分厂 |' });
    assert.equal(out.ok, true);
    assert.deepEqual(sent!.current_resources, ['金工分厂', '外协']);
  });

  it('原文引述一字不改地传过去 —— 提案里的出处要能追回文档那一句', async () => {
    rememberVerdicts('proj-1', '工艺.docx', [verdict]);
    await run({ name: '工艺.docx', quote: '| 粗加工 | 锻件分厂 |' });
    assert.equal(sent!.source_text, '| 粗加工 | 锻件分厂 |');
    assert.equal(sent!.document, '工艺.docx');
  });

  it('组合值拆成多个资源 —— 「金工分厂/外协」是两个,不是一个叫这名字的车间', async () => {
    rememberVerdicts('proj-1', 'c.docx', [{
      ...verdict,
      assertion: { ...verdict.assertion, object: '金工分厂/外协', quote: '| 粗加工 | 金工分厂/外协 |' },
    }]);
    await run({ name: 'c.docx', quote: '| 粗加工 | 金工分厂/外协 |' });
    assert.deepEqual(sent!.resources, ['金工分厂', '外协']);
  });
});

describe('产能类断言(现在接上了)', () => {
  const capVerdict = {
    assertion: { kind: 'capacity_k' as const, subject: '120MN水压机', object: '1',
                 quote: '120MN水压机 同时只能压 1 件。' },
    status: 'conflict' as const,
    detail: '不一致:文档说 1,系统里在用 80(来源:估值)。',
  };

  it('**把数字传过去**,并且不带工序范围 —— 产能和资格是两件事', async () => {
    rememberVerdicts('proj-1', 'k.docx', [capVerdict]);
    sent = undefined;
    const out = await run({ name: 'k.docx', quote: '120MN水压机 同时只能压 1 件。' });
    assert.equal(out.ok, true, String(out.error));
    assert.equal(sent!.parallel_k, 1);
    assert.deepEqual(sent!.resources, ['120MN水压机']);
    assert.ok(!sent!.op, '产能提案不该带工序范围');
  });

  it('不是数字的照旧拒 —— 「很多」提不出一条规则', async () => {
    rememberVerdicts('proj-1', 'x.docx', [{
      ...capVerdict,
      assertion: { ...capVerdict.assertion, object: '很多', quote: '压很多件' },
    }]);
    const out = await run({ name: 'x.docx', quote: '压很多件' });
    assert.equal(out.ok, false);
    assert.match(String(out.error), /数|很多/);
  });
});
