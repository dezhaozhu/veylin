/**
 * 表格变更日志 —— agent 靠重新读表**永远读不出"改过"这件事**。
 *
 * 引用(拉)解决"你在看什么",变更(推)解决"发生过什么":重新读表只能看到新值,看不到
 * 从什么改成什么、也看不到是人改的还是系统改的。没有它,agent 会把人的决策当成系统
 * 状态,还会重复建议已经被否掉的方案。
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordTableEdits,
  recentTableEdits,
  formatTableEditsBlock,
  clearTableEdits,
  MAX_EDITS_PER_THREAD,
} from './table-edit-journal.js';

describe('table edit journal', () => {
  beforeEach(() => clearTableEdits());

  it('records what changed, from what to what, and who did it', () => {
    recordTableEdits({
      threadId: 't1', sheet: 'orders', by: 'human',
      edits: [{ rowKey: 'r1', column: 'due_at', from: '2026-07-05', to: '2026-08-01' }],
    });

    const e = recentTableEdits('t1')[0]!;
    assert.equal(e.sheet, 'orders');
    assert.equal(e.rowKey, 'r1');
    assert.equal(e.column, 'due_at');
    assert.equal(e.from, '2026-07-05');
    assert.equal(e.to, '2026-08-01');
    assert.equal(e.by, 'human');
    assert.ok(e.at);
  });

  it('keeps threads apart', () => {
    recordTableEdits({ threadId: 't1', sheet: 's', by: 'human',
      edits: [{ rowKey: 'r1', column: 'c', from: 1, to: 2 }] });
    recordTableEdits({ threadId: 't2', sheet: 's', by: 'human',
      edits: [{ rowKey: 'r9', column: 'c', from: 3, to: 4 }] });

    assert.deepEqual(recentTableEdits('t1').map((e) => e.rowKey), ['r1']);
    assert.deepEqual(recentTableEdits('t2').map((e) => e.rowKey), ['r9']);
  });

  it('drops the oldest beyond the cap so a long session cannot grow without bound', () => {
    for (let i = 0; i < MAX_EDITS_PER_THREAD + 10; i += 1) {
      recordTableEdits({ threadId: 't1', sheet: 's', by: 'human',
        edits: [{ rowKey: `r${i}`, column: 'c', from: i, to: i + 1 }] });
    }
    const kept = recentTableEdits('t1');
    assert.equal(kept.length, MAX_EDITS_PER_THREAD);
    assert.equal(kept[kept.length - 1]!.rowKey, `r${MAX_EDITS_PER_THREAD + 9}`, '留最新的');
  });

  it('a no-op edit (same value) is not recorded — it is not a change', () => {
    recordTableEdits({ threadId: 't1', sheet: 's', by: 'human',
      edits: [{ rowKey: 'r1', column: 'c', from: 'x', to: 'x' }] });
    assert.deepEqual(recentTableEdits('t1'), []);
  });

  it('formats a block that says who changed what, newest last', () => {
    recordTableEdits({ threadId: 't1', sheet: 'orders', by: 'human',
      edits: [{ rowKey: 'T-1', column: '交期', from: '2026-07-05', to: '2026-08-01' }] });

    const block = formatTableEditsBlock('t1');
    assert.match(block, /表格变更/);
    assert.match(block, /T-1/);
    assert.match(block, /交期/);
    assert.match(block, /2026-07-05 → 2026-08-01/);
    assert.match(block, /用户/, '要说清是人改的 —— 系统自己改的 agent 本来就知道');
  });

  it('no edits → empty block (nothing injected)', () => {
    assert.equal(formatTableEditsBlock('t-none'), '');
  });
});
