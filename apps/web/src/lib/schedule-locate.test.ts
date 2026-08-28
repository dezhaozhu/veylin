import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasGantt,
  locateGantt,
  locateTable,
  registerGanttCapability,
  unregisterGanttCapability,
  setLocateTableImpl,
  shouldLocateGanttFromTableClick,
  placeJobIdAfterOrderId,
  scheduleLocateFromDate,
} from './schedule-locate.js';

describe('ScheduleLocatePort', () => {
  beforeEach(() => {
    unregisterGanttCapability();
    setLocateTableImpl(() => {});
  });

  it('没注册能力时 hasGantt 为 false，locateGantt 不调用任何实现', () => {
    let called = 0;
    registerGanttCapability({
      locateGantt: () => {
        called += 1;
      },
    });
    unregisterGanttCapability();
    locateGantt({ jobId: 'J1' });
    assert.equal(hasGantt(), false);
    assert.equal(called, 0);
  });

  it('注册后 locateGantt 把 target 原样交给实现', () => {
    const seen: unknown[] = [];
    registerGanttCapability({
      locateGantt: (t) => {
        seen.push(t);
      },
    });
    locateGantt({ jobId: 'J1', orderId: 'O1' });
    assert.equal(hasGantt(), true);
    assert.deepEqual(seen, [{ jobId: 'J1', orderId: 'O1' }]);
  });

  it('locateTable 与甘特能力无关：没甘特也能把订单交给表格实现', () => {
    const seen: unknown[] = [];
    setLocateTableImpl((t) => {
      seen.push(t);
    });
    locateTable({ orderId: 'O1' });
    assert.deepEqual(seen, [{ orderId: 'O1' }]);
  });

  it('locateTable 把作业号原样交给表格实现', () => {
    const seen: unknown[] = [];
    setLocateTableImpl((t) => {
      seen.push(t);
    });
    locateTable({ jobId: 'Z-1-QY', orderId: 'Z-1' });
    assert.deepEqual(seen, [{ jobId: 'Z-1-QY', orderId: 'Z-1' }]);
  });
});

describe('shouldLocateGanttFromTableClick', () => {
  it('只有作业号列才从表格跳甘特', () => {
    assert.equal(shouldLocateGanttFromTableClick('job_id'), true);
  });

  it('勾选、产品、订单号、状态、可编辑列都不跳', () => {
    for (const colId of ['ag-Grid-SelectionColumn', 'product', 'order_id', 'status', 'resource', '']) {
      assert.equal(shouldLocateGanttFromTableClick(colId), false, colId);
    }
  });
});

describe('placeJobIdAfterOrderId', () => {
  it('把作业号从末列挪到订单号后面', () => {
    const cols = [
      { key: 'order_id' },
      { key: 'product' },
      { key: 'status' },
      { key: 'job_id' },
    ];
    assert.deepEqual(
      placeJobIdAfterOrderId(cols).map((c) => c.key),
      ['order_id', 'job_id', 'product', 'status'],
    );
  });

  it('已经在订单号后面就不动', () => {
    const keys = ['order_id', 'job_id', 'product'];
    assert.deepEqual(
      placeJobIdAfterOrderId(keys.map((key) => ({ key }))).map((c) => c.key),
      keys,
    );
  });

  it('没有作业号列就原样返回', () => {
    const keys = ['order_id', 'product'];
    assert.deepEqual(
      placeJobIdAfterOrderId(keys.map((key) => ({ key }))).map((c) => c.key),
      keys,
    );
  });
});

describe('scheduleLocateFromDate', () => {
  it('取开工日的年月日,给甘特窗口当锚', () => {
    assert.equal(scheduleLocateFromDate({ start: '2026-03-15T08:00:00' }), '2026-03-15');
    assert.equal(scheduleLocateFromDate({ start_date: '2026-04-01' }), '2026-04-01');
    assert.equal(scheduleLocateFromDate({ start: '' }), undefined);
  });
});
