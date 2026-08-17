/**
 * 整条链的回归网:**对照 → 改 → 那一问 → 提案**,不带模型。
 *
 * 为什么需要它:这条链此前只被一条 Playwright e2e 证明过,而那条**不稳定** ——
 * 模型每轮的选择不同(有一轮它先反问"你要改文档还是同步系统",那恰恰是设计要的
 * 行为)。靠模型驱动的脚本测不了回归:它红了,你分不清是链路坏了还是模型换了主意。
 *
 * 所以这里按顺序**直接调工具**,断言的是链路自己的接缝:
 *   - 对照的结论有没有按 (项目, 文档) 存住
 *   - 改完那一问认不认得这一句
 *   - 改完之后引述变了,提案还找不找得到(真跑踩过的坑)
 *   - 传给 Compass 的参数对不对(字段名对不上过一次,而且悄无声息)
 *
 * Compass 用替身:契约那一层由 doc-assertions 的真回参测试守着,这里守的是**接缝**。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { closeDb, connectDb } from '@veylin/db';

import { createProject } from './project-store.js';
import { buildTableTools } from './table-tools.js';

const TENANT = '66666666-6666-4666-8666-666666666666';
const DOC = '工艺说明.md';

/** Compass 替身:回的是 get_op_eligibility 的**真实形状**(equipment[].resource)。 */
const compassCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
const compassToolset = {
  get_op_eligibility: {
    execute: async (args: unknown) => {
      compassCalls.push({ tool: 'get_op_eligibility', args: args as Record<string, unknown> });
      return {
        rows: [{
          op_code: 'F001_X', op_name: '性能热处理', flexibility: 'limited',
          equipment: [{ resource: 'YZ0803-5', count: 40, share: 0.6 },
                      { resource: 'YZ0803-7', count: 27, share: 0.4 }],
        }],
        not_found: [],
      };
    },
  },
  propose_rule_from_document: {
    execute: async (args: unknown) => {
      compassCalls.push({ tool: 'propose_rule_from_document', args: args as Record<string, unknown> });
      return { ok: true, proposal_id: 'p-1', warning: '会排除 YZ0803-5、YZ0803-7', next: 'show_shadow(...)' };
    },
  },
};

let folder: string;
let projectId: string;
let tools: Record<string, { execute: (a: unknown, c?: unknown) => Promise<Record<string, unknown>> }>;
let ctx: unknown;

before(async () => {
  await connectDb();
  folder = mkdtempSync(join(tmpdir(), 'chain-'));
  writeFileSync(join(folder, DOC), [
    '# 工艺说明', '',
    '| 工序 | 实施部门 |', '| --- | --- |',
    '| 性能热处理 | 锻件分厂 |', '',
  ].join('\n'));
  const p = await createProject(TENANT, { name: '链路', sources: ['shangzhong'] });
  projectId = p.id;
  const { updateProject } = await import('./project-store.js');
  await updateProject(TENANT, projectId, { folder });

  tools = buildTableTools(() => ({ compass: compassToolset }), () => ({})) as never;
  ctx = {
    requestContext: new Map<string, unknown>([
      ['tenantId', TENANT],
      ['pinnedProjectScope', { id: projectId, entryPin: 'compass' }],
      ['scopedMcpToolsets', { compass: compassToolset }],
    ]),
  };
});

after(async () => {
  rmSync(folder, { recursive: true, force: true });
  await closeDb();
});

describe('文档 → 规则 整条链(无模型)', () => {
  it('① 对照:调 Compass 取事实,给出逐条结论', async () => {
    const out = await tools.reconcile_document!.execute({ name: DOC }, ctx);
    // 抽断言那一步要真模型,拿不到就跳过后面的链路断言 —— 但要说出来,不能静默绿。
    if (!out.ok) {
      assert.match(String(out.error), /模型|抽断言/, `不是模型原因的失败: ${String(out.error)}`);
      console.log('    (跳过:这台机器没有可用模型 —— 抽断言那步需要它)');
      return;
    }
    assert.ok(Array.isArray(out.verdicts) && (out.verdicts as unknown[]).length > 0);
    assert.ok(compassCalls.some((c) => c.tool === 'get_op_eligibility'), '没去 Compass 取事实');
  });

  it('②③ 改 → 那一问 → 提案(改完引述变了也要找得到)', async () => {
    const { rememberVerdicts } = await import('./doc-change-intent.js');
    // 不依赖模型:直接把对照结论放进去,测的是**接缝**不是抽取。
    rememberVerdicts(projectId, DOC, [{
      assertion: { kind: 'op_resource', subject: '性能热处理', object: '锻件分厂',
                   quote: '| 性能热处理 | 锻件分厂 |' },
      status: 'conflict',
      detail: '不一致:系统里实际是 YZ0803-5 60%、YZ0803-7 40%。',
      systemResources: ['YZ0803-5', 'YZ0803-7'],
    }]);

    const edited = await tools.document_edit!.execute({
      name: DOC, find: '| 性能热处理 | 锻件分厂 |', replace: '| 性能热处理 | 大锻所 |',
    }, ctx);
    assert.equal(edited.ok, true, String(edited.error));
    assert.match(String(edited.note), /副本/);
    // **那一问**要挂上来,并带着系统侧的真实资源
    assert.ok(edited.ask_next, '改完没有带出那一问');
    assert.match(String(edited.ask_next), /YZ0803-5/);

    // **用改后的原文提案** —— 真跑踩到的坑:引述变了就查不到,模型只好重跑对照
    compassCalls.length = 0;
    const proposed = await tools.propose_rule_from_document!.execute({
      name: DOC, quote: '| 性能热处理 | 大锻所 |',
    }, ctx);
    assert.equal(proposed.ok, true, String(proposed.error));

    const sent = compassCalls.find((c) => c.tool === 'propose_rule_from_document')?.args;
    assert.ok(sent, '没调到 Compass 的提案工具');
    assert.equal(sent!.op, '性能热处理');
    // **提案提的是文档原来那句**(锻件分厂),不是改完的 —— 别名只是为了找得到
    assert.deepEqual(sent!.resources, ['锻件分厂']);
    // **这条最要紧**:系统里现在在用谁,提案才说得出自己排除了谁
    assert.deepEqual(sent!.current_resources, ['YZ0803-5', 'YZ0803-7']);
    assert.equal(sent!.document, DOC);
  });

  it('**没对照过就提案 → 拒**,并说该先做什么', async () => {
    const out = await tools.propose_rule_from_document!.execute(
      { name: '没对照过.md', quote: 'x' }, ctx);
    assert.equal(out.ok, false);
    assert.match(String(out.error), /reconcile_document/);
  });
});
