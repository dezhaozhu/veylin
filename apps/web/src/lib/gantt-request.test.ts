import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGanttThreadId, ganttErrorMessage } from './gantt-request.js';

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
