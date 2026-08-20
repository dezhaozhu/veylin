import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadDhtmlxGantt, isDhtmlxAvailable, __setCachedForTests } from './dhtmlx-gantt-loader.js';

describe('isDhtmlxAvailable 三态', () => {
  // 每条用例先用测试专用出口把 `cached` 摆到它要断言的那一态,不依赖其它用例跑没
  // 跑过、跑的顺序是什么——`loadDhtmlxGantt({ importer })` 本身对缓存零副作用
  // (见 dhtmlx-gantt-loader.ts 里的写守卫),所以三态没法靠它间接驱动出来。

  it('未加载:模块级缓存还没写过(undefined),回 false', () => {
    __setCachedForTests(undefined);
    assert.equal(isDhtmlxAvailable(), false);
  });

  it('加载成功:缓存里是真模块,回 true', () => {
    __setCachedForTests({ Gantt: () => null });
    assert.equal(isDhtmlxAvailable(), true);
  });

  it('加载失败:缓存里是 null,回 false —— 不管是"没装"还是"装了但炸了",都算不可用', () => {
    __setCachedForTests(null);
    assert.equal(isDhtmlxAvailable(), false);
  });
});

describe('dhtmlx 可选加载', () => {
  it('装不到就回 null,不抛 —— 外部用户没有私有源凭据,那是正常状态不是故障', async () => {
    const mod = await loadDhtmlxGantt({ importer: async () => { throw new Error('not found'); } });
    assert.equal(mod, null);
  });

  it('装得到就把模块给出去', async () => {
    const fake = { Gantt: () => null };
    const mod = await loadDhtmlxGantt({ importer: async () => fake });
    assert.equal(mod, fake);
  });
});

describe('未安装 vs 装了但初始化炸 —— 诊断信息要能分清', () => {
  it('两种失败往 console.debug 落不同的话,且都不抛、都回 null', async () => {
    const calls: unknown[][] = [];
    const original = console.debug;
    console.debug = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      const notFoundErr = Object.assign(new Error("Cannot find package '@dhx/react-gantt'"), {
        code: 'ERR_MODULE_NOT_FOUND',
      });
      const modA = await loadDhtmlxGantt({ importer: async () => { throw notFoundErr; } });
      assert.equal(modA, null);

      const initErr = new Error('gantt.init is not a function');
      const modB = await loadDhtmlxGantt({ importer: async () => { throw initErr; } });
      assert.equal(modB, null);
    } finally {
      console.debug = original;
    }

    assert.equal(calls.length, 2);
    assert.match(String(calls[0][0]), /未安装/);
    assert.match(String(calls[1][0]), /已安装但/);
  });
});
