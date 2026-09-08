import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NAVIGATE_FRESH_MS, shouldFireNavigate } from './navigate-fire';

const NOW = 1_800_000_000_000;
const fresh = (over: Record<string, unknown> = {}) => ({
  ok: true,
  anchor: { kind: 'job', id: 'J1', order_id: 'SO1', at: '2026-09-10' },
  surface: 'gantt',
  issued_at: NOW - 1_000,
  ...over,
});

describe('shouldFireNavigate — agent navigate 结果什么时候真的动右栏', () => {
  it('刚发出的 ok 结果 → 一次,且同一 toolCallId 不再触发', () => {
    const seen = new Set<string>();
    assert.deepEqual(shouldFireNavigate(fresh(), 'c1', { now: NOW, seen }), {
      kind: 'job', id: 'J1', orderId: 'SO1', at: '2026-09-10', surface: 'gantt',
    });
    assert.equal(shouldFireNavigate(fresh(), 'c1', { now: NOW, seen }), null);
    // 另一条调用照常
    assert.ok(shouldFireNavigate(fresh(), 'c2', { now: NOW, seen }));
  });

  it('旧结果(回看历史)不触发;未来时间戳也不信', () => {
    const seen = new Set<string>();
    assert.equal(shouldFireNavigate(fresh({ issued_at: NOW - NAVIGATE_FRESH_MS - 1 }), 'c1', { now: NOW, seen }), null);
    assert.equal(shouldFireNavigate(fresh({ issued_at: NOW + 60_000 }), 'c1', { now: NOW, seen }), null);
    assert.equal(seen.size, 0, '没触发就不该记成已见');
  });

  it('ok=false / 缺 issued_at / 锚点不合法 → 不触发', () => {
    const seen = new Set<string>();
    assert.equal(shouldFireNavigate(fresh({ ok: false }), 'c1', { now: NOW, seen }), null);
    assert.equal(shouldFireNavigate(fresh({ issued_at: undefined }), 'c1', { now: NOW, seen }), null);
    assert.equal(shouldFireNavigate(fresh({ anchor: { kind: 'rule', id: 'R' } }), 'c1', { now: NOW, seen }), null);
    assert.equal(shouldFireNavigate('nope', 'c1', { now: NOW, seen }), null);
  });
});
