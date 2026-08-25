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

  // 最终评审 F3:spec §5 点名的四种诚实标记(拼炉/会凉/超载/锁定)之前只画了
  // 两种 —— violations.max_lag / violations.cap_overloads 被原样收下却一眼
  // 没画。字段形状按 gantt_service.py 源码 + tests/api/test_gantt_service.py
  // 钉定:max_lag 项带 task_id(= bar 的 job_id),cap_overloads 项只聚合到
  // resource(定位不到具体哪根 bar,只能落在泳道父行)。
  it('violations.max_lag 命中的 job 加 maxlag 标记', () => {
    const withMaxLag = {
      ...payload,
      violations: { max_lag: [{ task_id: 'J1', allowed_days: 1, exceeded_by_days: 4 }] },
    };
    const bar = toGanttTasks(withMaxLag).tasks.find((t) => t.id === 'job:J1')!;
    assert.ok(bar.marks.includes('maxlag'));
  });

  it('violations.cap_overloads 命中的泳道父行加 overload 标记,不是子 bar', () => {
    const withOverload = {
      ...payload,
      violations: { cap_overloads: [{ resource: 'WC10', month: '2026-09', over: 2 }] },
    };
    const { tasks } = toGanttTasks(withOverload);
    const lane = tasks.find((t) => t.id === 'lane:WC10')!;
    const bar = tasks.find((t) => t.id === 'job:J1')!;
    assert.ok(lane.marks.includes('overload'));
    assert.ok(!bar.marks.includes('overload'));
  });

  it('没有 violations 字段时不炸 —— 空标记,不是抛错', () => {
    const bare = { ...payload, violations: undefined };
    const { tasks } = toGanttTasks(bare);
    assert.deepEqual(tasks.find((t) => t.id === 'lane:WC10')!.marks, []);
  });

  // 最终评审 F5:order 视角泳道级截断(4,218 条泳道、lane_limit=20 时只显示
  // 20 条)之前零诚实标记 —— truncatedNote 只看 bars_dropped(泳道内条数截
  // 断),不比较 meta.lane_total 与实际返回的泳道数。
  it('lanesHidden = 真实泳道总数 - 实际返回的泳道数', () => {
    // fixture 的 meta.lane_total 是 3,但只返回了 1 条泳道(WC10)。
    assert.equal(toGanttTasks(payload).lanesHidden, 2);
  });

  it('泳道没被截断时 lanesHidden 是 0', () => {
    const full = { ...payload, meta: { ...payload.meta, lane_total: 1 } };
    assert.equal(toGanttTasks(full).lanesHidden, 0);
  });

  it('meta 缺 lane_total 时不假装截断 —— 退回按实际返回的泳道数算', () => {
    const noMeta = { ...payload, meta: undefined };
    assert.equal(toGanttTasks(noMeta).lanesHidden, 0);
  });
});

describe('三级子行的 id', () => {
  const twoStagesOneOrder = {
    meta: { view: 'resource', lane_total: 1 },
    lanes: [{
      lane: 'WC10', kind: 'resource', total_bars: 2,
      bars: [
        {
          job_id: 'L2-1', order_id: 'MO-1', label: 'MO-1·下料',
          start: '2026-09-01', end: '2026-09-02', resource: 'WC10',
          children: [{ _work_order_id: 'T0001', op_seq: 10, op_name: '下料',
                       planned_start: '2026-09-01', planned_end: '2026-09-01' }],
        },
        {
          job_id: 'L2-2', order_id: 'MO-1', label: 'MO-1·焊接',
          start: '2026-09-03', end: '2026-09-04', resource: 'WC10',
          children: [{ _work_order_id: 'T0001', op_seq: 10, op_name: '下料',
                       planned_start: '2026-09-01', planned_end: '2026-09-01' }],
        },
      ],
    }],
    truncated: null,
  };

  it('用三级行自己的身份,不是 undefined', () => {
    const { tasks } = toGanttTasks(twoStagesOneOrder as never);
    const kids = tasks.filter((t) => t.parent?.startsWith('job:') && t.id.startsWith('wo:'));
    assert.equal(kids.length, 2);
    assert.ok(kids.every((k) => !k.id.includes('undefined')), `子行 id 里不该有 undefined: ${kids.map((k) => k.id).join(',')}`);
  });

  it('同一订单的多条二级共享同一份三级时,子行 id 不许相撞', () => {
    // children 按订单号建键,所以同订单的每条二级都会挂上同一批三级。
    // id 若只取三级自身,两个父行下就是同一个 id —— dhtmlx 的树会直接乱。
    const { tasks } = toGanttTasks(twoStagesOneOrder as never);
    const ids = tasks.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, `id 撞了: ${ids.join(',')}`);
  });
});
