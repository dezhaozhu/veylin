/**
 * 焦段之间的锚点 —— 切换粒度时"我刚才在看的那一单"必须跟着走。
 *
 * 这是用户对"多表切换"唯一真正的担心:查来查去、每切一次都要重新找位置。
 * 三张表是同一个模型的三个焦段(订单 / 工序 / 派工),锚点让切换变成**变焦**而不是**跳表**。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { anchorOfRow, rowMatchesAnchor } from './grain-anchor.js';

describe('anchorOfRow: 从任一焦段的行上认出"这是哪一单"', () => {
  it('订单/工序行用 order_id', () => {
    assert.equal(anchorOfRow({ order_id: 'T-221523002', workshop: '金工分厂' }), 'T-221523002');
  });

  it('派工行没有 order_id,用 wbs —— 三级只认 WBS', () => {
    assert.equal(anchorOfRow({ wbs: 'W1', op_name: '第一火' }), 'W1');
  });

  it('认不出来就是认不出来,不猜', () => {
    assert.equal(anchorOfRow({ resource: 'YZ0202-4', load_days: 120 }), null);
    assert.equal(anchorOfRow(undefined), null);
  });
});

describe('rowMatchesAnchor: 换了焦段之后,哪些行是"同一单"', () => {
  it('同一层:直接相等', () => {
    assert.equal(rowMatchesAnchor({ order_id: 'A' }, 'A'), true);
    assert.equal(rowMatchesAnchor({ order_id: 'B' }, 'A'), false);
  });

  it('订单号是逗号拼起来的 WBS 列表,派工行的 wbs 是其中之一', () => {
    // Compass 里 OrderRow.order_id 就是这么存的(多 WBS 合成一单)
    assert.equal(rowMatchesAnchor({ wbs: 'W2' }, 'W1,W2'), true);
    assert.equal(rowMatchesAnchor({ wbs: 'W3' }, 'W1,W2'), false);
  });

  it('反过来也算:从派工(锚点=W2)切回订单层,那张合成单要认得出来', () => {
    assert.equal(rowMatchesAnchor({ order_id: 'W1,W2' }, 'W2'), true);
  });

  it('空锚点谁都不匹配 —— 不能变成"全选"', () => {
    assert.equal(rowMatchesAnchor({ order_id: 'A' }, null), false);
    assert.equal(rowMatchesAnchor({ order_id: 'A' }, ''), false);
  });

  it('空白与大小写不影响(编码里带空格是真出现过的脏数据)', () => {
    assert.equal(rowMatchesAnchor({ wbs: ' W2 ' }, 'W1, W2'), true);
  });
});
