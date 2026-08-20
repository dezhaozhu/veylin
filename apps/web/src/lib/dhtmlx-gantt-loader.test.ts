import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadDhtmlxGantt, isDhtmlxAvailable } from './dhtmlx-gantt-loader.js';

// 注意:模块级缓存(`cached`)是单例,下面按文件书写顺序执行(node:test 默认顺序
// 跑),"未加载"这条必须排在任何一次 loadDhtmlxGantt 调用之前,否则读到的就不是
// 真·初始态了。

describe('isDhtmlxAvailable 三态', () => {
  it('未加载:进程刚起、还没调过 loadDhtmlxGantt,回 false', () => {
    assert.equal(isDhtmlxAvailable(), false);
  });

  it('加载成功后回 true', async () => {
    await loadDhtmlxGantt({ importer: async () => ({ Gantt: () => null }) });
    assert.equal(isDhtmlxAvailable(), true);
  });

  it('加载失败后回 false —— 不管是"没装"还是"装了但炸了",都算不可用', async () => {
    await loadDhtmlxGantt({ importer: async () => { throw new Error('boom'); } });
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
