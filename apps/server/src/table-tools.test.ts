/**
 * Unit tests for buildTableTools — the load_compass_schedule tool + table_get pagination.
 *
 * The table store is an in-memory singleton. DB persistence calls (tablePersist) are
 * fire-and-forget and fail silently when no SurrealDB is available, so in-memory
 * assertions work fine without any DB setup.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTableTools } from './table-tools.js';
import {
  listTableRows,
  listTableColumns,
  importTableSheet,
  listTableRowsPage,
} from './table-store.js';
import { PERSONAL_SCOPE, projectScope, sheetIdFor } from './table-scope.js';

/**
 * 表有归属:项目数据只能落在项目里。工具从 ctx 的 projectPin 推出作用域,
 * 所以这些用例得**装作在一个项目里** —— 不给 pin 就是个人区,装载会被拒。
 */
const PIN = 'proj-test';
const ctxIn = (pin: string | null) => ({
  requestContext: {
    get: (k: string) => {
      if (k === 'projectPin') return pin;
      // compass 装载读的是这一份(装载作用域 + provenance 都从它来)
      if (k === 'pinnedProjectScope') return pin ? { id: pin, entryPin: null } : null;
      return null;
    },
  },
});
const SCHEDULE_ID = sheetIdFor(projectScope(PIN), 'schedule');
const MAIN_ID = sheetIdFor(PERSONAL_SCOPE, 'main');

describe('load_compass_schedule', () => {
  it('writes get_schedule_rows output into the schedule sheet', async () => {
    // Fake the Compass MCP toolset: one tool whose execute returns typed columns + rows.
    const fakeGetSchedule = {
      execute: async (_args: unknown) => ({
        columns: [
          { key: 'order_id', name: 'order_id', type: 'text' },
          { key: 'qty', name: 'qty', type: 'number' },
        ],
        rows: [
          { order_id: 'O1', qty: 3 },
          { order_id: 'O2', qty: 5 },
        ],
        total: 2,
        returned: 2,
      }),
    };

    const getToolsets = () => ({ compass: { get_schedule_rows: fakeGetSchedule } });
    const tools = buildTableTools(getToolsets);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (tools.load_compass_schedule.execute as any)({ limit: 100 }, ctxIn(PIN));

    assert.equal(out.ok, true);
    assert.equal(out.sheet, SCHEDULE_ID, '落在这个项目的作用域里');
    assert.equal(out.imported, 2);

    // Verify the in-memory store was populated.
    const rows = listTableRows(SCHEDULE_ID);
    assert.equal(rows.length, 2);
    const cols = listTableColumns(SCHEDULE_ID);
    assert.equal(cols.length, 2);
  });

  it('errors cleanly when no compass MCP server is connected', async () => {
    const tools = buildTableTools(() => ({})); // no compass toolset
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (tools.load_compass_schedule.execute as any)({}, ctxIn(PIN));

    assert.equal(out.ok, false);
    assert.match(String(out.error), /compass|not connected|get_schedule_rows/i);
  });

  it('没选项目时说的是"没选项目",不是"没连上" —— 原因要对', async () => {
    // 装载前就拒:项目数据只能落在项目里(spec §3.4)。以前是靠解析不到 compass
    // 入口间接失败,报 "not connected" —— 人照着这个提示去查连接,查不出所以然。
    const tools = buildTableTools(() => ({ compass: { get_schedule_rows: { execute: async () => ({}) } } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (tools.load_compass_schedule.execute as any)({}, ctxIn(null));

    assert.equal(out.ok, false);
    assert.match(String(out.error), /没有选项目/);
  });
});

describe('table_get pagination', () => {
  it('returns a bounded page with totalRows and hasMore', async () => {
    importTableSheet(MAIN_ID, ['name', 'qty'], [
      { name: 'A', qty: 1 },
      { name: 'B', qty: 2 },
      { name: 'C', qty: 3 },
    ]);

    const { table_get } = buildTableTools();
    const page1 = await table_get.execute!(
      { offset: 0, limit: 2 },
      {} as never,
    );
    assert.ok(page1 && typeof page1 === 'object' && 'totalRows' in page1);
    assert.equal(page1.totalRows, 3);
    // table_get's rows/columns are now optional at the type level (absent on
    // the project-pin-mismatch refusal path) — this test's page never refuses.
    assert.equal(page1.rows!.length, 2);
    assert.equal(page1.hasMore, true);
    assert.match(page1.notice ?? '', /offset=2/);

    const page2 = await table_get.execute!({ offset: 2, limit: 2 }, {} as never);
    assert.ok(page2 && typeof page2 === 'object' && 'rows' in page2);
    assert.equal(page2.rows!.length, 1);
    assert.equal(page2.hasMore, false);
  });

  it('listTableRowsPage never returns more rows than exist', () => {
    const { totalRows, rows } = listTableRowsPage(MAIN_ID, 0, 9999);
    assert.equal(totalRows, 3);
    assert.equal(rows.length, 3);
  });
});

describe('importTableSheet with column descriptors (B1: friendly headers + badges)', () => {
  it('keeps the source key, uses the display name, and preserves custom status options', () => {
    const result = importTableSheet(
      MAIN_ID,
      [], // names path unused when descriptors are provided
      [
        { order_id: 'O1', schedule_status: 'derived' },
        { order_id: 'O2', schedule_status: 'solved' },
      ],
      undefined,
      [
        { key: 'order_id', name: '订单号', type: 'text' },
        { key: 'schedule_status', name: '排产状态', type: 'status', statusOptions: ['derived', 'solved', 'unscheduled'] },
      ],
    );
    assert.ok(result);
    const cols = listTableColumns(MAIN_ID);
    const byKey = Object.fromEntries(cols.map((c) => [c.key, c]));
    // key stays English (matches row data), NOT slugified from the Chinese name
    assert.ok(byKey['order_id'] && byKey['schedule_status']);
    assert.equal(byKey['order_id']!.name, '订单号');
    assert.equal(byKey['schedule_status']!.name, '排产状态');
    assert.equal(byKey['schedule_status']!.type, 'status');
    assert.deepEqual(byKey['schedule_status']!.statusOptions, ['derived', 'solved', 'unscheduled']);
    // custom statuses survive the sanitizer (not blanked)
    const rows = listTableRows(MAIN_ID);
    assert.deepEqual(
      rows.map((r) => r['schedule_status']),
      ['derived', 'solved'],
    );
  });
});
