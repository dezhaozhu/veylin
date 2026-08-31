import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  jobIdForTask,
  orderIdForTask,
  resolveFocusTarget,
  decideGanttFocusFollowUp,
  isTreeToggleTarget,
  applyGanttTaskFocus,
  ganttFocusRetryDelay,
  GANTT_FOCUS_RETRY_MAX,
} from './gantt-focus.js';

const tasks = [
  { id: 'lane:WC10' }, { id: 'job:J1' }, { id: 'job:J2' }, { id: 'wo:T1' },
];

describe('定位目标', () => {
  it('优先命中具体那道工序', () => {
    assert.equal(resolveFocusTarget(tasks, { jobId: 'J2' }), 'job:J2');
  });

  it('这道工序不在当前窗口里就回 null —— 让调用方去换窗口,而不是乱滚一个', () => {
    assert.equal(resolveFocusTarget(tasks, { jobId: 'J9' }), null);
  });

  it('只知道订单号时,命中该订单的第一条', () => {
    const t = [{ id: 'job:J1', orderId: 'O1' }, { id: 'job:J2', orderId: 'O2' }];
    assert.equal(resolveFocusTarget(t, { orderId: 'O2' }), 'job:J2');
  });

  it('点了具体作业但窗口里没有时,不准拿同订单另一道工序凑数', () => {
    const t = [
      { id: 'job:Z-221524A0770211-CJ1', orderId: 'Z-221524A0770211' },
    ];
    assert.equal(
      resolveFocusTarget(t, {
        jobId: 'Z-221524A0770211-QY',
        orderId: 'Z-221524A0770211',
      }),
      null,
    );
  });

  it('两个都没给,回 null', () => {
    assert.equal(resolveFocusTarget(tasks, {}), null);
  });
});

describe('从点到的条反查订单号(甘特 → 表格)', () => {
  const t = [
    { id: 'lane:WC10' },
    { id: 'job:J1', parent: 'lane:WC10', orderId: 'O1' },
    { id: 'wo:T1', parent: 'job:J1' },
  ];

  it('点的就是二级条,直接有 orderId', () => {
    assert.equal(orderIdForTask(t, 'job:J1'), 'O1');
  });

  it('点的是三级子条,顺着 parent 链找到二级条的 orderId', () => {
    assert.equal(orderIdForTask(t, 'wo:T1'), 'O1');
  });

  it('点的是泳道父行(没有订单号可言),回 undefined —— 不假装知道', () => {
    assert.equal(orderIdForTask(t, 'lane:WC10'), undefined);
  });

  it('点到一个不存在的 id,回 undefined', () => {
    assert.equal(orderIdForTask(t, 'wo:GHOST'), undefined);
  });
});

describe('从点到的条反查作业号(甘特 → 表格按 job_id 对)', () => {
  const t = [
    { id: 'lane:WC10' },
    { id: 'job:Z-221524A0780211-QY', parent: 'lane:WC10' },
    { id: 'wo:Z-221524A0780211-QY:T1', parent: 'job:Z-221524A0780211-QY' },
  ];

  it('点的就是二级条,id 前缀 job: 后面就是作业号', () => {
    assert.equal(jobIdForTask(t, 'job:Z-221524A0780211-QY'), 'Z-221524A0780211-QY');
  });

  it('点的是三级子条,顺着 parent 链找到二级条的作业号', () => {
    assert.equal(jobIdForTask(t, 'wo:Z-221524A0780211-QY:T1'), 'Z-221524A0780211-QY');
  });

  it('点的是泳道父行,回 undefined —— 不假装知道', () => {
    assert.equal(jobIdForTask(t, 'lane:WC10'), undefined);
  });

  it('点到一个不存在的 id,回 undefined', () => {
    assert.equal(jobIdForTask(t, 'wo:GHOST'), undefined);
  });
});

describe('点在树的展开图标上', () => {
  // 真机实证(2026-08-25):点展开箭头会**同时**触发 onTaskOpened 和 onTaskClick。
  // 两个功能各自都对,但跳转会把整个甘特面板卸载 —— 展开永远渲染不出来。
  const fakeEl = (cls: string, parentCls?: string) => ({
    closest: (sel: string) =>
      cls.includes(sel.replace('.', '')) || parentCls?.includes(sel.replace('.', ''))
        ? { tag: 'div' }
        : null,
  });

  it('点在展开图标上 → 认出来,好让跳转让路', () => {
    assert.equal(isTreeToggleTarget(fakeEl('gantt_tree_icon gantt_close')), true);
  });

  it('点在图标的子元素上也算 —— 判定要沿 DOM 往上找', () => {
    assert.equal(isTreeToggleTarget(fakeEl('inner', 'gantt_tree_icon')), true);
  });

  it('点在别处(条、文字)不算,跳转照常', () => {
    assert.equal(isTreeToggleTarget(fakeEl('gantt_task_line')), false);
  });

  it('没有事件目标时不算 —— 宁可跳转,也不要静默吞掉点击', () => {
    assert.equal(isTreeToggleTarget(undefined), false);
    assert.equal(isTreeToggleTarget(null), false);
  });
});

describe('applyGanttTaskFocus', () => {
  it('实例还没就绪就回 false,别假装选中了', () => {
    assert.equal(applyGanttTaskFocus(null, 'job:J1'), false);
    assert.equal(applyGanttTaskFocus({}, 'job:J1'), false);
  });

  it('实例上还没有这条就回 false,好留给下一帧再试', () => {
    const seen: string[] = [];
    const ok = applyGanttTaskFocus(
      {
        isTaskExists: () => false,
        selectTask: (id) => {
          seen.push(id);
        },
      },
      'job:J1',
    );
    assert.equal(ok, false);
    assert.deepEqual(seen, []);
  });

  it('展开父泳道、滚到这条、选中它', () => {
    const log: string[] = [];
    const ok = applyGanttTaskFocus(
      {
        isTaskExists: () => true,
        open: (id) => {
          log.push(`open:${id}`);
        },
        showTask: (id) => {
          log.push(`show:${id}`);
        },
        selectTask: (id) => {
          log.push(`select:${id}`);
        },
      },
      'job:J1',
      'lane:WC10',
    );
    assert.equal(ok, true);
    assert.deepEqual(log, ['open:lane:WC10', 'show:job:J1', 'select:job:J1']);
  });
});

describe('decideGanttFocusFollowUp —— 分屏后图还挂着,找不到必须换窗口而不是清掉', () => {
  it('窗口里有这一条就当场对准', () => {
    assert.equal(decideGanttFocusFollowUp(tasks, { jobId: 'J2' }, false), 'apply');
  });

  it('图还是空的就等 —— 第一次取数还没回来,清掉等于定位被吃掉', () => {
    assert.equal(decideGanttFocusFollowUp([], { jobId: 'J9' }, false), 'wait');
  });

  it('图上有条但没有这一道:还没换过窗口 → 换窗口,不许清掉', () => {
    assert.equal(decideGanttFocusFollowUp(tasks, { jobId: 'J9' }, false), 'reload');
  });

  it('换过窗口还是没有 → 放弃,别死循环重拉', () => {
    assert.equal(decideGanttFocusFollowUp(tasks, { jobId: 'J9' }, true), 'give-up');
  });
});

describe('ganttFocusRetryDelay', () => {
  it('前 30 次都隔 50ms,够甘特重挂后把条认进树', () => {
    assert.equal(ganttFocusRetryDelay(0), 50);
    assert.equal(ganttFocusRetryDelay(29), 50);
    assert.equal(ganttFocusRetryDelay(GANTT_FOCUS_RETRY_MAX), null);
  });
});
