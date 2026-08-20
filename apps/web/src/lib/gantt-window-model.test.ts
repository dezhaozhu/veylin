import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toGanttTasks } from './gantt-window-model.js';

const payload = {
  meta: { view: 'resource', lane_total: 3, status: 'feasible' },
  lanes: [
    {
      lane: 'WC10',
      kind: 'resource',
      total_bars: 2,
      bars: [
        {
          job_id: 'J1',
          order_id: 'O1',
          label: 'O1·下料',
          start: '2026-09-01',
          end: '2026-09-02',
          resource: 'WC10',
          late_days: 3,
          frozen: true,
          batch_id: 'B1',
        },
      ],
    },
  ],
  truncated: { bars_dropped: 1 },
};

describe('甘特窗口 → dhtmlx 数据', () => {
  it('泳道变成父行,条挂在它下面', () => {
    const { tasks } = toGanttTasks(payload);
    const lane = tasks.find((t) => t.id === 'lane:WC10')!;
    assert.equal(lane.type, 'project');
    assert.equal(tasks.find((t) => t.id === 'job:J1')!.parent, 'lane:WC10');
  });

  it('诚实标记全部带过去 —— 换控件不等于换口径', () => {
    const bar = toGanttTasks(payload).tasks.find((t) => t.id === 'job:J1')!;
    assert.deepEqual(bar.marks.sort(), ['batch', 'frozen', 'late'].sort());
  });

  it('截断要能说出来,不能悄悄少画', () => {
    assert.match(toGanttTasks(payload).truncatedNote!, /1/);
  });

  it('没截断时不留一句吓人的话', () => {
    const clean = { ...payload, truncated: null };
    assert.equal(toGanttTasks(clean).truncatedNote, null);
  });

  // 控制方增补(task-6-brief.md):下一刀要按订单号在表格↔甘特之间双向定位,
  // 只有二级那条 bar 认识订单号 —— 泳道父行是资源/车间的名字,三级子行是工序,
  // 两者都没有(也不该冒充有)订单号。
  it('订单号只挂在二级那条 bar 上 —— 泳道父行和三级子行都不带', () => {
    const { tasks } = toGanttTasks(payload);
    assert.equal(tasks.find((t) => t.id === 'job:J1')!.orderId, 'O1');
    assert.equal(tasks.find((t) => t.id === 'lane:WC10')!.orderId, undefined);
  });
});
