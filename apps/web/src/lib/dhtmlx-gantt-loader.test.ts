import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadDhtmlxGantt } from './dhtmlx-gantt-loader.js';

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
