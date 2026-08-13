/**
 * 选区引用 —— 用户在表格里圈一块,@ 进对话。
 *
 * **引用不是快照。** 存的是"哪些行、哪些列、当时怎么分组筛选的",不是那一刻的值:
 * agent 拿着它去取**当前值**。三万行的表里选 200 行,把数据塞进对话既撑爆上下文,
 * 又会把陈旧数据钉死在里面 —— 五分钟后排产变了,对话里那份还在,agent 会拿它当真。
 * (与 G1 修的是同一个病:陈旧数据被当依据。)
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerSelection,
  getSelection,
  clearSelections,
  formatSelectionToken,
  MAX_SELECTIONS_PER_THREAD,
} from './table-selection.js';

describe('table selection reference', () => {
  beforeEach(() => clearSelections());

  it('stores rows, columns and the view state, and hands back a short id', () => {
    const sel = registerSelection({
      threadId: 't1', sheet: 'schedule',
      rowKeys: ['r1', 'r2', 'r3'], columns: ['due_at', 'end'],
      groupBy: ['workshop'], filter: '曲轴',
    });

    assert.match(sel.id, /^[a-z0-9]{6,}$/);
    const got = getSelection('t1', sel.id)!;
    assert.deepEqual(got.rowKeys, ['r1', 'r2', 'r3']);
    assert.deepEqual(got.columns, ['due_at', 'end']);
    assert.deepEqual(got.groupBy, ['workshop']);
    assert.equal(got.filter, '曲轴');
  });

  it('a selection belongs to its thread only', () => {
    const sel = registerSelection({ threadId: 't1', sheet: 's', rowKeys: ['r1'], columns: [] });
    assert.equal(getSelection('t2', sel.id), undefined, '别的会话取不到 —— 与项目钉定同一条边界');
  });

  it('the token a human sees says what was picked, not the data', () => {
    const sel = registerSelection({
      threadId: 't1', sheet: 'schedule', rowKeys: ['a', 'b', 'c'],
      columns: ['交期', '资源'], groupBy: ['分厂'],
    });
    const token = formatSelectionToken(sel);

    assert.match(token, /schedule/);
    assert.match(token, /3 行/);
    assert.match(token, /交期/);
    assert.match(token, /分厂/, '分组状态是问题的一半——"这里为什么堆这么多"里的"这里"');
    assert.doesNotMatch(token, /值/, '不带数据');
    assert.match(token, new RegExp(sel.id));
  });

  it('keeps only the newest selections per thread', () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_SELECTIONS_PER_THREAD + 3; i += 1) {
      ids.push(registerSelection({ threadId: 't1', sheet: 's', rowKeys: [`r${i}`], columns: [] }).id);
    }
    assert.equal(getSelection('t1', ids[0]!), undefined, '最老的被挤掉');
    assert.ok(getSelection('t1', ids[ids.length - 1]!), '最新的还在');
  });

  it('an empty selection is refused — there is nothing to reference', () => {
    assert.throws(() => registerSelection({ threadId: 't1', sheet: 's', rowKeys: [], columns: [] }),
                  /选区为空/);
  });
});
