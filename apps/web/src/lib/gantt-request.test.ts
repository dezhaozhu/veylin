import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGanttThreadId, ganttErrorMessage, ganttWindowUrl, withExpanded } from './gantt-request.js';

describe('resolveGanttThreadId —— remoteId ?? externalId ?? localId', () => {
  it('remoteId 赢,即便 externalId 和 id 都在', () => {
    assert.equal(
      resolveGanttThreadId({ id: 'local1', remoteId: 'remote1', externalId: 'ext1' }),
      'remote1',
    );
  });

  it('没有 remoteId 时 externalId 赢', () => {
    assert.equal(resolveGanttThreadId({ id: 'local1', externalId: 'ext1' }), 'ext1');
  });

  it('都没有服务端 id 时落回本地 composer id', () => {
    assert.equal(resolveGanttThreadId({ id: 'local1' }), 'local1');
  });

  it('三个都没有就是 undefined —— 不能拼出一个假的 threadId', () => {
    assert.equal(resolveGanttThreadId({}), undefined);
  });

  it('null 和缺失一视同仁', () => {
    assert.equal(resolveGanttThreadId({ id: 'local1', remoteId: null, externalId: null }), 'local1');
  });
});

describe('ganttErrorMessage —— 服务端的话原样透传,不许被换成"加载失败"', () => {
  it('有 message 就原样用它,不碰 fallback', () => {
    assert.equal(
      ganttErrorMessage({ message: '这一轮对话没有钉定项目 —— 请在输入框上选一个项目。' }, '加载失败'),
      '这一轮对话没有钉定项目 —— 请在输入框上选一个项目。',
    );
  });

  it('message 缺失才落回 fallback', () => {
    assert.equal(ganttErrorMessage({}, '加载失败'), '加载失败');
  });

  it('message 是空字符串也当没有,落回 fallback', () => {
    assert.equal(ganttErrorMessage({ message: '' }, '加载失败'), '加载失败');
  });

  it('body 本身是 null/undefined 也不炸,落回 fallback', () => {
    assert.equal(ganttErrorMessage(null, '加载失败'), '加载失败');
    assert.equal(ganttErrorMessage(undefined, '加载失败'), '加载失败');
  });

  it('message 不是字符串(比如后端手滑传了个对象)也不能直接渲染,落回 fallback', () => {
    assert.equal(ganttErrorMessage({ message: { oops: true } }, '加载失败'), '加载失败');
  });
});

describe('展开三级', () => {
  it('URL 带上要展开的订单号,逗号分隔', () => {
    const url = ganttWindowUrl('t1', 'resource', ['MO-1', 'MO-2']);
    assert.match(url, /expand=MO-1%2CMO-2|expand=MO-1,MO-2/);
  });

  it('没有要展开的就不带这个参数 —— 别让服务端为空列表白跑一趟', () => {
    assert.doesNotMatch(ganttWindowUrl('t1', 'resource', []), /expand/);
    assert.doesNotMatch(ganttWindowUrl('t1', 'resource'), /expand/);
  });

  it('表格定位时带上开工日和更大的泳道窗,否则默认窗对不上那一行', () => {
    const url = ganttWindowUrl('t1', 'resource', [], { fromDate: '2026-03-01', laneLimit: 200 });
    assert.match(url, /from_date=2026-03-01/);
    assert.match(url, /lane_limit=200/);
  });

  it('没有定位窗就不带 from_date / lane_limit', () => {
    const url = ganttWindowUrl('t1', 'resource');
    assert.doesNotMatch(url, /from_date=/);
    assert.doesNotMatch(url, /lane_limit=/);
  });

  it('同一个订单展开两次不重复请求 —— 集合去重且保持顺序', () => {
    assert.deepEqual(withExpanded(['MO-1'], 'MO-2'), ['MO-1', 'MO-2']);
    assert.equal(withExpanded(['MO-1', 'MO-2'], 'MO-1'), null, '已经在里面就回 null,让调用方跳过重拉');
  });

  it('订单号为空就不动 —— 展开的是泳道父行之类,没有订单可展', () => {
    assert.equal(withExpanded(['MO-1'], undefined), null);
  });
});
