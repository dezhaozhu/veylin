/**
 * navigate 工具:服务端只校验+回显,动作在客户端。这里钉的是「回显的形状」——
 * 客户端(NavigateToolUI)按 issued_at 判新鲜、按 anchor/surface 走同一个
 * useNavigateAnchor,形状一变两边就对不上。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNavigateTools, type NavigateAnchor } from './navigate-tool';

type Out = { ok: boolean; error?: string; anchor?: NavigateAnchor; surface?: 'gantt' | 'grid'; issued_at?: number };
// execute() 的静态返回类型带 void | ValidationError 分支(mastra createTool 的签名),
// 这里只关心成功路径的形状,统一收窄。
const run = async (input: Record<string, unknown>) =>
  (await buildNavigateTools().navigate.execute!(input as never, {} as never)) as Out;

test('job 锚点原样回显,附 surface 默认 gantt 与发出时刻', async () => {
  const before = Date.now();
  const out = await run({ kind: 'job', id: 'T-1.001-CJ1', order_id: 'T-1.001', at: '2026-09-10T00:00:00' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.anchor, { kind: 'job', id: 'T-1.001-CJ1', order_id: 'T-1.001', at: '2026-09-10' });
  assert.equal(out.surface, 'gantt');
  assert.ok(typeof out.issued_at === 'number' && out.issued_at >= before);
});

test('surface=grid 透传;kind=view 只认三个视角', async () => {
  const grid = await run({ kind: 'order', id: 'SO-9', surface: 'grid' });
  assert.equal(grid.surface, 'grid');
  assert.deepEqual(grid.anchor, { kind: 'order', id: 'SO-9' });

  const view = await run({ kind: 'view', id: 'workshop' });
  assert.equal(view.ok, true);

  const bad = await run({ kind: 'view', id: 'gantt' });
  assert.equal(bad.ok, false);
  assert.match(bad.error ?? '', /resource\|workshop\|order/);
  assert.equal(bad.anchor, undefined);
});
