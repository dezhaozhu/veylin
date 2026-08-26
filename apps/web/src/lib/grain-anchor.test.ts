/**
 * 焦段之间的锚点 —— 切换粒度时"我刚才在看的那一单"必须跟着走。
 *
 * 这是用户对"多表切换"唯一真正的担心:查来查去、每切一次都要重新找位置。
 * 三张表是同一个模型的三个焦段(订单 / 工序 / 派工),锚点让切换变成**变焦**而不是**跳表**。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { anchorOfRow, pickLocateRows, rowMatchesAnchor, rowMatchesLocateTarget } from './grain-anchor.js';

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

describe('rowMatchesLocateTarget: 甘特→表格按作业号对,不准凑同单第一行', () => {
  it('给了 jobId 就只认这一行的 job_id', () => {
    const qy = { job_id: 'Z-1-QY', order_id: 'Z-1' };
    const cj1 = { job_id: 'Z-1-CJ1', order_id: 'Z-1' };
    assert.equal(rowMatchesLocateTarget(qy, { jobId: 'Z-1-QY', orderId: 'Z-1' }), true);
    assert.equal(rowMatchesLocateTarget(cj1, { jobId: 'Z-1-QY', orderId: 'Z-1' }), false);
  });

  it('只给订单号时,仍走原来的焦段锚点(同单第一行)', () => {
    assert.equal(rowMatchesLocateTarget({ job_id: 'Z-1-CJ1', order_id: 'Z-1' }, { orderId: 'Z-1' }), true);
    assert.equal(rowMatchesLocateTarget({ job_id: 'Z-2-QY', order_id: 'Z-2' }, { orderId: 'Z-1' }), false);
  });
});

describe('pickLocateRows: 作业号优先,续灌没到就等,全部到齐再退回订单号', () => {
  const rows = [
    { job_id: 'Z-1-CJ1', order_id: 'Z-1' },
    { job_id: 'Z-1-QY', order_id: 'Z-1' },
    { job_id: 'Z-2-QY', order_id: 'Z-2' },
  ];

  it('点了 QY 就落到 QY,不落到同单的 CJ1', () => {
    const picked = pickLocateRows(rows, { jobId: 'Z-1-QY', orderId: 'Z-1' }, { hasMore: false });
    assert.equal(picked.status, 'hit');
    assert.deepEqual(picked.rows.map((r) => r.job_id), ['Z-1-QY']);
  });

  it('作业号还没灌到、后面还有行 → 等,不准先凑同单第一行', () => {
    const firstPage = [{ job_id: 'Z-1-CJ1', order_id: 'Z-1' }];
    const picked = pickLocateRows(firstPage, { jobId: 'Z-1-QY', orderId: 'Z-1' }, { hasMore: true });
    assert.equal(picked.status, 'wait');
    assert.deepEqual(picked.rows, []);
  });

  it('全部到齐仍没有这道作业 → 退回该单第一行', () => {
    const noQy = [{ job_id: 'Z-1-CJ1', order_id: 'Z-1' }];
    const picked = pickLocateRows(noQy, { jobId: 'Z-1-QY', orderId: 'Z-1' }, { hasMore: false });
    assert.equal(picked.status, 'hit');
    assert.deepEqual(picked.rows.map((r) => r.job_id), ['Z-1-CJ1']);
  });

  it('作业和订单都对不上 → miss', () => {
    const picked = pickLocateRows(rows, { jobId: 'GHOST', orderId: 'NOPE' }, { hasMore: false });
    assert.equal(picked.status, 'miss');
  });

  it('只带订单号时行为与原来一样', () => {
    const picked = pickLocateRows(rows, { orderId: 'Z-1' }, { hasMore: false });
    assert.equal(picked.status, 'hit');
    assert.deepEqual(picked.rows.map((r) => r.job_id), ['Z-1-CJ1', 'Z-1-QY']);
  });
});
