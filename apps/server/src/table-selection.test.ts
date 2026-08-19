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
  listSelectionIds,
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

  it('id 前面带 # 也认 —— 人看到的 token 就是 #a1b2c3d4,agent 常常连 # 一起抄过来', () => {
    // 真实翻车:@表格[orders · 1 行 #d69788cd] → agent 传 selection_id="#d69788cd"
    // → 查不到 → 回答"选区已过期,请重新圈选"。选区好好的,是我们没剥那个井号。
    const sel = registerSelection({ threadId: 't1', sheet: 's', rowKeys: ['r1'], columns: [] });
    assert.ok(getSelection('t1', `#${sel.id}`), '带 # 应当取得到');
    assert.ok(getSelection('t1', ` ${sel.id} `), '前后空白也不该挡住');
  });

  it('表名一起抄过来也认 —— token 里 id 前面就贴着表名', () => {
    // 真实翻车(2026-08-18 上重):token 是 @表格[p_8657…~schedule · 4 行 · 列: product_class
    // #2d71be5a],agent 传 selection_id="p_8657…~schedule#2d71be5a" → 查不到 → 用户看到
    // "选区已过期,请重新圈选"。选区登记成功(日志 200),会话也没错 —— 是我们的 id 解析
    // 只挡了"开头的 #"这一半。id 在最后一个 # 之后,认它。
    const sel = registerSelection({ threadId: 't1', sheet: 'p_x~schedule', rowKeys: ['r1'], columns: [] });
    assert.ok(getSelection('t1', `p_x~schedule#${sel.id}`), '表名限定的 id 应当取得到');
    assert.ok(getSelection('t1', `@表格[p_x~schedule · 1 行 #${sel.id}]`), '整条 token 抄过来也应认');
  });

  it('剥了 # 也不能把别的 id 认成自己', () => {
    registerSelection({ threadId: 't1', sheet: 's', rowKeys: ['r1'], columns: [] });
    assert.equal(getSelection('t1', '#deadbeef'), undefined);
  });

  it('本会话现有哪些选区 —— 查不到时要能说人话,而不是断言"已过期"', () => {
    const a = registerSelection({ threadId: 't1', sheet: 's', rowKeys: ['r1'], columns: [] });
    const b = registerSelection({ threadId: 't1', sheet: 's', rowKeys: ['r2'], columns: [] });
    assert.deepEqual(listSelectionIds('t1'), [a.id, b.id]);
    assert.deepEqual(listSelectionIds('t2'), []);
  });

  it('an empty selection is refused — there is nothing to reference', () => {
    assert.throws(() => registerSelection({ threadId: 't1', sheet: 's', rowKeys: [], columns: [] }),
                  /选区为空/);
  });
});
