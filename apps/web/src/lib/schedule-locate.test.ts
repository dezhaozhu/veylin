import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasGantt,
  locateGantt,
  locateTable,
  registerGanttCapability,
  unregisterGanttCapability,
  setLocateTableImpl,
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
