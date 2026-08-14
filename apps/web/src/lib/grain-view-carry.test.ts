/**
 * 切焦段时,分组和筛选跟着走 —— 但**列不在新焦段就得说出来**。
 *
 * 工序级有「分厂」,派工级只有「设备/工作中心」。按分厂分着组切过去,那个分组
 * 无处安放。悄悄丢掉是最糟的:人会以为还筛着,读出错的结论。原型里那条
 * 「筛选迁移·已移除」就是干这个的。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { carryViewAcrossGrain } from './grain-view-carry.js';

const cols = (...keys: string[]) => new Set(keys);

describe('carryViewAcrossGrain', () => {
  it('列在新焦段里 → 原样带过去', () => {
    const out = carryViewAcrossGrain(
      { groupBy: ['workshop'], filters: { workshop: '金工分厂' } },
      cols('workshop', 'order_id'),
    );
    assert.deepEqual(out.groupBy, ['workshop']);
    assert.deepEqual(out.filters, { workshop: '金工分厂' });
    assert.deepEqual(out.dropped, []);
  });

  it('列不在新焦段 → 丢掉,并且报出来丢了什么', () => {
    const out = carryViewAcrossGrain(
      { groupBy: ['workshop'], filters: { workshop: '金工分厂', stage_code: 'CJ1' } },
      cols('wbs', 'resource_id'),
    );
    assert.deepEqual(out.groupBy, []);
    assert.deepEqual(out.filters, {});
    assert.deepEqual(
      out.dropped.map((d) => d.key).sort(),
      ['stage_code', 'workshop'],
      '两项都要报,不能只报一项',
    );
  });

  it('一半能带一半不能 —— 带能带的,报丢掉的', () => {
    const out = carryViewAcrossGrain(
      { groupBy: ['workshop', 'product'], filters: { order_id: 'T-1', workshop: '金工' } },
      cols('order_id', 'product'),
    );
    assert.deepEqual(out.groupBy, ['product']);
    assert.deepEqual(out.filters, { order_id: 'T-1' });
    assert.deepEqual(out.dropped.map((d) => d.key), ['workshop']);
  });

  it('同一个 key 既在分组又在筛选里,只报一次', () => {
    const out = carryViewAcrossGrain(
      { groupBy: ['workshop'], filters: { workshop: '金工' } }, cols('wbs'),
    );
    assert.equal(out.dropped.length, 1);
  });

  it('空的搜索词不算筛选,不必报', () => {
    const out = carryViewAcrossGrain(
      { groupBy: [], filters: { workshop: '  ' } }, cols('wbs'),
    );
    assert.deepEqual(out.dropped, []);
    assert.deepEqual(out.filters, {});
  });

  it('什么都没设 → 什么都不报', () => {
    const out = carryViewAcrossGrain({ groupBy: [], filters: {} }, cols('wbs'));
    assert.deepEqual(out, { groupBy: [], filters: {}, dropped: [] });
  });
});
