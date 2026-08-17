/**
 * table_chart —— 在表格面板上就地画一张图。
 *
 * 它原来一条测试都没有(和 resource_load widget 同一类缺口)。这里钉三件:
 * 列名写错要**拒绝并列出可用列**、真的发出了渲染事件、以及不认识的列不会被
 * 悄悄丢掉画出一张"少了一条线"的图 —— 那种图看起来完全正常,但答案是错的。
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { closeDb, connectDb } from '@veylin/db';

import { buildTableTools } from './table-tools.js';
import {
  addTableColumn,
  createTableSheet,
  onTableEvent,
  type TableEvent,
} from './table-store.js';
import { PERSONAL_SCOPE } from './table-scope.js';

before(async () => { await connectDb(); });
after(async () => { await closeDb(); });

async function sheetWithColumns(name: string): Promise<{ id: string; cols: [string, string] }> {
  const sheet = createTableSheet(name, PERSONAL_SCOPE);
  assert.ok(sheet, `建不出 sheet: ${name}`);
  const id = sheet!.id;
  // 签名是 (sheetId, name) —— key 由列名派生,不是自己指定的。
  const a = addTableColumn(id, 'resource');
  const b = addTableColumn(id, 'load_days');
  assert.ok(a && b, '列没加上');
  return { id, cols: [a!.key, b!.key] as [string, string] };
}

function captureEvents(): { events: TableEvent[]; stop: () => void } {
  const events: TableEvent[] = [];
  const stop = onTableEvent((e) => events.push(e));
  return { events, stop };
}

describe('table_chart', () => {
  it('列名写错时**拒绝并列出可用列** —— 和 table_query 同一条规矩', async () => {
    const { id, cols } = await sheetWithColumns('chart-bad-cols');
    const tools = buildTableTools();
    const out = (await tools.table_chart.execute!(
      { sheet: id, columns: [cols[0], 'nonexistent'] }, {} as never,
    )) as { ok: boolean; error?: string };
    assert.equal(out.ok, false);
    assert.match(out.error ?? '', /nonexistent/);
    assert.match(out.error ?? '', /可用列/);
  });

  it('**不悄悄丢掉不认识的列** —— 少一条线的图看起来完全正常,但答案是错的', async () => {
    const { id, cols } = await sheetWithColumns('chart-silent-drop');
    const { events, stop } = captureEvents();
    const tools = buildTableTools();
    const out = (await tools.table_chart.execute!(
      { sheet: id, columns: [...cols, 'ghost'] }, {} as never,
    )) as { ok: boolean };
    stop();
    assert.equal(out.ok, false, '有一列不认识就该整个拒绝,不能画剩下的');
    assert.equal(events.filter((e) => e.type === 'chart').length, 0, '拒绝了就不该发渲染事件');
  });

  it('列都对时真的发出渲染事件,带上图表类型', async () => {
    const { id, cols } = await sheetWithColumns('chart-ok');
    const { events, stop } = captureEvents();
    const tools = buildTableTools();
    const out = (await tools.table_chart.execute!(
      { sheet: id, columns: cols, chart_type: 'bar' }, {} as never,
    )) as { ok: boolean; chart?: string };
    stop();
    assert.equal(out.ok, true);
    const chart = events.find((e) => e.type === 'chart') as
      | { type: 'chart'; sheet: string; columns: string[]; chartType: string }
      | undefined;
    assert.ok(chart, '没有发出渲染事件 —— 前端不会画任何东西');
    assert.deepEqual(chart!.columns, cols);
    assert.equal(chart!.chartType, 'bar');
  });

  it('不给类型时默认 column,而不是留空让前端猜', async () => {
    const { id, cols } = await sheetWithColumns('chart-default');
    const { events, stop } = captureEvents();
    const tools = buildTableTools();
    await tools.table_chart.execute!({ sheet: id, columns: cols }, {} as never);
    stop();
    const chart = events.find((e) => e.type === 'chart') as { chartType: string } | undefined;
    assert.equal(chart?.chartType, 'column');
  });
});
