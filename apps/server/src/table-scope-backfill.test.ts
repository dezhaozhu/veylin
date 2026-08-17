/**
 * 老表的归属回填(spec §3.6、§5 第 6 条)。
 *
 * 老库里的表没有 scope,id 也没有前缀。回填规则只有三条,且**幂等** —— 这是本刀
 * 风险最高的一处:id 改写要级联 columns/rows,跑第二遍不能再动。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planScopeBackfill } from './table-scope-backfill.js';

const sheet = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, builtin: false, ...extra,
});

describe('planScopeBackfill', () => {
  it('带项目戳的表归那个项目', () => {
    const plan = planScopeBackfill([
      sheet('schedule', { source: { server: 'compass', project: 'proj-guolu' } }),
    ]);
    assert.deepEqual(plan, [
      { from: 'schedule', to: 'p_proj-guolu~schedule', scope: { kind: 'project', id: 'proj-guolu' } },
    ]);
  });

  it('老的对话级表归个人区 —— 留成 thread 就谁也看不见了', () => {
    // 今天没有任何入口会去列"某个对话的表"(作用域只从项目钉定推,spec §3.3);
    // 而这些表多半是用户在面板上点"+"建的,本来就该属于工作区。
    const plan = planScopeBackfill([sheet('tmp', { threadId: 't-9' })]);
    assert.deepEqual(plan[0], { from: 'tmp', to: 'me~tmp', scope: { kind: 'personal' } });
  });

  it('其余(含 main、自己导的没戳的表)归个人区', () => {
    const plan = planScopeBackfill([sheet('main', { builtin: true }), sheet('我的清单')]);
    assert.deepEqual(plan.map((p) => p.to), ['me~main', 'me~我的清单']);
  });

  it('项目戳仍然优先 —— compass 装的表曾经两个字段都有', () => {
    const plan = planScopeBackfill([
      sheet('schedule', { threadId: 't-1', source: { server: 'compass', project: 'p9' } }),
    ]);
    assert.equal(plan[0]!.to, 'p_p9~schedule');
  });

  it('只有 server 没有 project 的老戳:归个人区,不猜项目', () => {
    // 猜错了就是把一个项目的数据塞进另一个项目 —— 宁可留在个人区等人重装。
    const plan = planScopeBackfill([sheet('schedule', { source: { server: 'compass-guolu' } })]);
    assert.equal(plan[0]!.to, 'me~schedule');
  });

  it('已经带前缀的表不再动 —— 幂等', () => {
    const plan = planScopeBackfill([
      sheet('p_guolu~schedule', { scope: { kind: 'project', id: 'guolu' } }),
      sheet('me~main'),
    ]);
    assert.deepEqual(plan, []);
  });

  it('回填后撞名的,加序号而不是互相覆盖', () => {
    // 老库里 `schedule` 与 `me~schedule` 可能同时存在(后者是新代码建的)
    const plan = planScopeBackfill([sheet('me~schedule'), sheet('schedule')]);
    assert.equal(plan.length, 1);
    assert.equal(plan[0]!.to, 'me~schedule_1');
  });
});
