/**
 * 表格面板该不该去 Compass 拉排产。
 *
 * 从前是**无条件拉**:`compassLoading` 初值就是 true,一挂载就 POST。于是在
 * 一个和 Compass 毫无关系的项目里(用户实测的「111」),右侧一打开就先闪一句
 * 「正在从 Compass 加载排产数据…」,接着弹一个「Compass 排产未加载」的错误提示 ——
 * 讲了一个根本不成立的故事,还把它说成出错。
 *
 * 服务端本身是按项目钉定的(没 compass 就诚实拒绝,不会串数据),所以问题
 * 全在客户端:**先知道有没有,再决定说什么**。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideCompassLoad } from './compass-schedule-load';

const p = (id: string, sources: string[]) => ({ id, name: id, sources, managed: false });

describe('decideCompassLoad', () => {
  it('**项目接了数据源 → 拉**', () => {
    assert.equal(
      decideCompassLoad({ threadId: 't1', projects: [p('proj', ['guolu'])],
                          threadProjects: { t1: 'proj' } }),
      'load',
    );
  });

  it('**项目没接数据源 → 不拉,也不提 Compass**', () => {
    assert.equal(
      decideCompassLoad({ threadId: 't1', projects: [p('proj', [])],
                          threadProjects: { t1: 'proj' } }),
      'skip',
    );
  });

  it('**没钉项目(个人区)→ 不拉**', () => {
    assert.equal(
      decideCompassLoad({ threadId: 't1', projects: [p('proj', ['guolu'])], threadProjects: {} }),
      'skip',
    );
  });

  it('**两份缓存还没到齐就先等** —— 这时候判 skip 会把真该拉的项目也漏掉', () => {
    assert.equal(
      decideCompassLoad({ threadId: 't1', projects: null, threadProjects: { t1: 'proj' } }),
      'wait',
    );
    assert.equal(
      decideCompassLoad({ threadId: 't1', projects: [p('proj', ['guolu'])], threadProjects: null }),
      'wait',
    );
  });

  it('没有 threadId 就不拉', () => {
    assert.equal(
      decideCompassLoad({ threadId: undefined, projects: [], threadProjects: {} }),
      'skip',
    );
  });

  it('钉的项目在列表里找不到(已删/未刷新)→ 不拉,不猜', () => {
    assert.equal(
      decideCompassLoad({ threadId: 't1', projects: [p('other', ['guolu'])],
                          threadProjects: { t1: '没了' } }),
      'skip',
    );
  });
});
