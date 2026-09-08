/**
 * 模型视图:小结果原样、大结果截数组并如实标注。量具照着生产消费的形状测 ——
 * 一份 1,500 根条的甘特(每根 ~240 字符)必须压到阈值内,且模型能看出被截了。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactForModel, MODEL_VIEW_LIMIT_CHARS, toModelOutputCompact } from './model-view';

const bar = (i: number) => ({
  job_id: `T-2215220${i}.00301-GP`, order_id: `T-2215220${i}.00301`, label: `T-2215220${i}.00301·GP`,
  start: '2026-09-01', end: '2026-09-20', resource: '冶铸分厂', late_days: 14, frozen: false, batch_id: null,
});

test('阈值内原样返回(同一引用)', () => {
  const small = { meta: { view: 'resource' }, lanes: [{ lane: 'A', bars: [bar(1), bar(2)] }] };
  assert.equal(compactForModel(small), small);
  assert.deepEqual(toModelOutputCompact(small), { type: 'json', value: small });
});

test('1,500 根条的甘特压到阈值内,并标出截了多少', () => {
  const lanes = Array.from({ length: 11 }, (_, l) => ({
    lane: `泳道${l}`, kind: 'resource', bars: Array.from({ length: 136 }, (_, i) => bar(l * 1000 + i)),
  }));
  const big = { meta: { view: 'resource', window: { start: '2026-09-01', end: '2026-10-31' } }, lanes, batches: [], violations: { max_lag: [], cap_overloads: [] } };
  assert.ok(JSON.stringify(big).length > 300_000, '样本不够大,测不到问题');

  const view = compactForModel(big) as { _model_view: { truncated: boolean; items_hidden: number }; lanes: Array<{ bars: unknown[] }>; meta: unknown };
  assert.ok(JSON.stringify(view).length <= MODEL_VIEW_LIMIT_CHARS, `还是太大:${JSON.stringify(view).length}`);
  assert.equal(view._model_view.truncated, true);
  assert.ok(view._model_view.items_hidden > 1000);
  assert.deepEqual(view.meta, big.meta, 'meta 不该被动');
  // 每条泳道保留了前几根 + 一条「还有 N 条」的说明
  const first = view.lanes[0]!.bars;
  assert.match(String(first[first.length - 1]), /还有 \d+ 条未给模型/);
  assert.equal((first[0] as { job_id: string }).job_id, bar(0).job_id, '截的是尾巴,不是头');
});

test('顶层就是数组时也能压,并包成 items', () => {
  const arr = Array.from({ length: 5000 }, (_, i) => ({ i, text: 'x'.repeat(40) }));
  const view = compactForModel(arr) as { _model_view: { truncated: true }; items: unknown[] };
  assert.equal(view._model_view.truncated, true);
  assert.ok(view.items.length <= 13);
  assert.ok(JSON.stringify(view).length <= MODEL_VIEW_LIMIT_CHARS);
});

test('非对象 / 空值原样', () => {
  assert.equal(compactForModel('text'), 'text');
  assert.equal(compactForModel(null), null);
  assert.equal(compactForModel(undefined), undefined);
});
