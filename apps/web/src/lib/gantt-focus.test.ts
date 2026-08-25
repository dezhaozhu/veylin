import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { orderIdForTask, resolveFocusTarget, isTreeToggleTarget } from './gantt-focus.js';

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
