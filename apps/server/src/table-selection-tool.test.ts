/** table_get 按选区取的是**当前值**,不是圈选那一刻的快照。 */
import { describe, it, beforeEach } from 'node:test';
import { threadScope } from './table-scope.js';
import assert from 'node:assert/strict';
import { buildTableTools } from './table-tools.js';
import { createTableSheet, importTableSheet, updateTableRow, listTableRows, tableRowKey } from './table-store.js';
import { registerSelection, clearSelections } from './table-selection.js';

type Ctx = { requestContext: { get(k: string): unknown } };
const ctxFor = (threadId: string): Ctx => ({
  requestContext: { get: (k: string) => (k === 'threadId' ? threadId : undefined) },
});

async function get(tools: ReturnType<typeof buildTableTools>, input: object, ctx?: Ctx) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tools.table_get.execute as any)(input, ctx ?? {});
}

describe('table_get + selection', () => {
  beforeEach(() => clearSelections());

  it('returns only the selected rows, with the values as they are NOW', async () => {
    const sheet = createTableSheet(`sel-${Date.now()}`, threadScope('th'))!;
    importTableSheet(sheet.id, ['order_id', 'due_at'],
      [{ order_id: 'A', due_at: '2026-07-05' }, { order_id: 'B', due_at: '2026-07-06' }]);
    const key = tableRowKey(listTableRows(sheet.id)[0]!);

    const sel = registerSelection({
      threadId: 'th', sheet: sheet.id, rowKeys: [key], columns: [],
    });
    // 圈选之后值又变了 —— 引用必须取到新值,而不是圈选那一刻的
    // 无 DB 的纯内存套件里 persist 是尽力而为(同 table-tools.test.ts 的容忍)
    await updateTableRow(key, { due_at: '2026-08-01' }, sheet.id).catch(() => undefined);

    const out = await get(buildTableTools(), { sheet: sheet.id, selection_id: sel.id }, ctxFor('th'));

    assert.equal(out.totalRows, 1, '只回选中的那一行');
    assert.equal(out.rows[0].due_at, '2026-08-01', '取的是当前值,不是快照');
  });

  it('narrows to the selected columns', async () => {
    const sheet = createTableSheet(`sel2-${Date.now()}`, threadScope('th'))!;
    importTableSheet(sheet.id, ['order_id', 'due_at', 'workshop'],
      [{ order_id: 'A', due_at: 'd', workshop: 'w' }]);
    const sel = registerSelection({
      threadId: 'th', sheet: sheet.id,
      rowKeys: [tableRowKey(listTableRows(sheet.id)[0]!)], columns: ['due_at'],
    });

    const out = await get(buildTableTools(), { sheet: sheet.id, selection_id: sel.id }, ctxFor('th'));

    assert.deepEqual(Object.keys(out.rows[0]).sort(), ['due_at', 'row_id']);
  });

  it('a selection from another thread is refused with a readable warning', async () => {
    const sheet = createTableSheet(`sel3-${Date.now()}`, threadScope('th'))!;
    importTableSheet(sheet.id, ['order_id'], [{ order_id: 'A' }]);
    const sel = registerSelection({
      threadId: 'other', sheet: sheet.id,
      rowKeys: [tableRowKey(listTableRows(sheet.id)[0]!)], columns: [],
    });

    const out = await get(buildTableTools(), { sheet: sheet.id, selection_id: sel.id }, ctxFor('th'));

    assert.match(out.warning, /没认出选区 id.*属于别的会话/s, '话要说得准:是这条会话里没有它');
    assert.equal(out.rows, undefined);
  });

  it('表名限定的 selection_id 照样取得到 —— agent 常常把 id 前面的表名一起抄过来', async () => {
    // 2026-08-18 上重实测:传的是 "p_…~schedule#2d71be5a",于是用户被告知"选区已过期,
    // 请重新圈选" —— 选区好好的。
    const sheet = createTableSheet(`sel4-${Date.now()}`, threadScope('th'))!;
    importTableSheet(sheet.id, ['order_id'], [{ order_id: 'A' }, { order_id: 'B' }]);
    const rows = listTableRows(sheet.id);
    const sel = registerSelection({
      threadId: 'th', sheet: sheet.id, rowKeys: [tableRowKey(rows[0]!)], columns: [],
    });

    const out = await get(buildTableTools(),
      { sheet: sheet.id, selection_id: `${sheet.id}#${sel.id}` }, ctxFor('th'));

    assert.equal(out.warning, undefined, '不该再回"已过期"');
    assert.equal(out.rows.length, 1);
  });

  it('真认不出时,说清楚本会话有哪些选区 —— 不把"没认出"说成"已过期"', async () => {
    const sheet = createTableSheet(`sel5-${Date.now()}`, threadScope('th'))!;
    importTableSheet(sheet.id, ['order_id'], [{ order_id: 'A' }]);
    const sel = registerSelection({
      threadId: 'th', sheet: sheet.id,
      rowKeys: [tableRowKey(listTableRows(sheet.id)[0]!)], columns: [],
    });

    const out = await get(buildTableTools(),
      { sheet: sheet.id, selection_id: 'deadbeef' }, ctxFor('th'));

    assert.match(out.warning, new RegExp(sel.id), '把现有的 id 报出来,让 agent 自己纠正');
    assert.doesNotMatch(out.warning, /已过期/);
  });
});
