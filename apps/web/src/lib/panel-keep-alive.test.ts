import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KEEP_ALIVE_PANEL_KINDS, splitPanelRender } from './panel-keep-alive.js';
import type { PanelTab } from '../components/assistant-ui/right-panel/panel-types.js';

function tab(id: string, kind: PanelTab['kind']): PanelTab {
  return { id, kind, title: kind };
}

describe('splitPanelRender', () => {
  it('表格页签即使不是当前页也保活', () => {
    const tabs = [tab('t1', 'table'), tab('g1', 'gantt')];
    const out = splitPanelRender(tabs, 'g1');
    assert.deepEqual(
      out.keepAlive.map((t) => t.id),
      ['t1'],
    );
    assert.equal(out.activeEphemeral?.id, 'g1');
  });

  it('当前就是表格时,没有临时页', () => {
    const tabs = [tab('t1', 'table')];
    const out = splitPanelRender(tabs, 't1');
    assert.equal(out.keepAlive[0]?.id, 't1');
    assert.equal(out.activeEphemeral, null);
  });

  it('没有表格页签时不保活', () => {
    const tabs = [tab('g1', 'gantt')];
    const out = splitPanelRender(tabs, 'g1');
    assert.equal(out.keepAlive.length, 0);
    assert.equal(out.activeEphemeral?.id, 'g1');
  });

  it('只保活表格,不保活甘特', () => {
    assert.equal(KEEP_ALIVE_PANEL_KINDS.has('table'), true);
    assert.equal(KEEP_ALIVE_PANEL_KINDS.has('gantt'), false);
  });
});
