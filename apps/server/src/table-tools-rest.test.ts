/**
 * REST-first data plane for the bulk sheet imports (spec 2026-08-06 三形态 §2
 * ①): when `scope.rest` is present, importCompassScheduleSheet /
 * importCompassOrderSheet fetch rows via plain GET (`fetchCompassData`) —
 * never touching the MCP toolset — before falling back to the existing
 * `get_schedule_rows` MCP tool on any REST failure (network error, non-200,
 * bad shape). Provenance stamping is unchanged either way: `source.project`
 * is always the pinned PROJECT id (`scope.projectId`), `source.tenant` comes
 * from the payload's `tenant` field — see table-tools-provenance.test.ts for
 * the invariant this must never regress.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/** 测试里读连接器来源的收窄小工具(来源现在是判别式两类,见 spec §4)。 */
const conn = (s: unknown) =>
  (s ?? {}) as { server?: string; project?: string; tenant?: string; loadedAt?: string };
import {
  importCompassScheduleSheet,
  importCompassOrderSheet,
  importCompassWorkorderSheet,
  SCHEDULE_SHEET_ID,
  ORDERS_SHEET_ID,
  WORKORDERS_SHEET_ID,
} from './table-tools.js';
import { getTableSheetMeta, listTableRows } from './table-store.js';
import { projectScope, sheetIdFor } from './table-scope.js';

// 表有归属:compass 装进来的落在**当前项目**里(spec §3.4),所以断言要按
// 作用域化后的内部 id 来查。
const idIn = (project: string, shortName: string) => sheetIdFor(projectScope(project), shortName);

/** Minimal `Response`-shaped stub — fetchCompassData only reads `.ok`/`.status`/`.json()`. */
function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const REST_PAYLOAD = {
  columns: [{ key: 'order_id', name: '订单', type: 'text' }],
  rows: [{ order_id: 'A' }],
  total: 1,
  tenant: 'guolu',
};

describe('importCompassScheduleSheet: REST data-plane first', () => {
  it('REST success: never touches MCP (getMcpToolsets undefined), stamps project=scope.projectId + tenant=payload.tenant', async () => {
    const fetchCalls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      fetchCalls.push(String(input));
      return fakeResponse(REST_PAYLOAD);
    }) as unknown as typeof fetch;

    const out = await importCompassScheduleSheet(
      undefined, // getMcpToolsets — REST path must never call this
      {},
      undefined, // getMcpGroups
      {
        entryPin: 'compass',
        projectId: 'p1',
        rest: { baseUrl: 'http://fake.compass.local', headers: {} },
      },
      { fetchImpl },
    );

    assert.equal(out.ok, true);
    assert.equal((out as { imported: number }).imported, 1);
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0]!, /\/data\/schedule-rows/);

    const meta = getTableSheetMeta(idIn('p1', SCHEDULE_SHEET_ID));
    assert.ok(meta?.source);
    assert.equal(conn(meta!.source).project, 'p1');
    assert.equal(conn(meta!.source).tenant, 'guolu');
  });

  it('REST failure falls back to the MCP get_schedule_rows tool (fetchImpl 404 → MCP stub called, still ok:true)', async () => {
    let fetchCalled = false;
    const fetchImpl = (async () => {
      fetchCalled = true;
      return fakeResponse({}, 404);
    }) as unknown as typeof fetch;

    let mcpCalled = false;
    const getMcpToolsets = () => ({
      compass: {
        get_schedule_rows: {
          execute: async () => {
            mcpCalled = true;
            return {
              columns: [{ key: 'order_id', name: '订单', type: 'text' }],
              rows: [{ order_id: 'B' }],
              total: 1,
              tenant: 'fallback-tenant',
            };
          },
        },
      },
    });
    const getMcpGroups = () => ({});

    const out = await importCompassScheduleSheet(
      getMcpToolsets,
      {},
      getMcpGroups,
      {
        entryPin: 'compass',
        projectId: 'p2',
        rest: { baseUrl: 'http://fake.compass.local', headers: {} },
      },
      { fetchImpl },
    );

    assert.equal(fetchCalled, true, 'REST attempt must still have been made');
    assert.equal(mcpCalled, true, 'must fall back to the MCP tool on REST failure');
    assert.equal(out.ok, true);
  });

  it('no scope.rest: behaves exactly like today (MCP-only path), never calls fetchImpl', async () => {
    let fetchCalled = false;
    const fetchImpl = (async () => {
      fetchCalled = true;
      return fakeResponse(REST_PAYLOAD);
    }) as unknown as typeof fetch;

    let mcpCalled = false;
    const getMcpToolsets = () => ({
      compass: {
        get_schedule_rows: {
          execute: async () => {
            mcpCalled = true;
            return {
              columns: [{ key: 'order_id', name: '订单', type: 'text' }],
              rows: [{ order_id: 'C' }],
              total: 1,
              tenant: 'no-rest-tenant',
            };
          },
        },
      },
    });
    const getMcpGroups = () => ({});

    const out = await importCompassScheduleSheet(
      getMcpToolsets,
      {},
      getMcpGroups,
      { entryPin: 'compass', projectId: 'p3' }, // no `rest`
      { fetchImpl },
    );

    assert.equal(out.ok, true);
    assert.equal(fetchCalled, false, 'fetchImpl must not be invoked when scope.rest is absent');
    assert.equal(mcpCalled, true);

    const meta = getTableSheetMeta(idIn('p3', SCHEDULE_SHEET_ID));
    assert.equal(conn(meta?.source).project, 'p3');
    assert.equal(conn(meta?.source).tenant, 'no-rest-tenant');
  });
});

describe('importCompassOrderSheet: REST data-plane first', () => {
  it('REST success: never touches MCP, aggregates rows, stamps project=scope.projectId + tenant=payload.tenant', async () => {
    const fetchImpl = (async () => fakeResponse(REST_PAYLOAD)) as unknown as typeof fetch;

    const out = await importCompassOrderSheet(
      undefined, // getMcpToolsets — REST path must never call this
      undefined, // getMcpGroups
      {
        entryPin: 'compass',
        projectId: 'p1',
        rest: { baseUrl: 'http://fake.compass.local', headers: {} },
      },
      { fetchImpl },
    );

    assert.equal(out.ok, true);
    assert.equal((out as { imported: number }).imported, 1); // one order_id 'A' aggregated

    const meta = getTableSheetMeta(idIn('p1', ORDERS_SHEET_ID));
    assert.ok(meta?.source);
    assert.equal(conn(meta!.source).project, 'p1');
    assert.equal(conn(meta!.source).tenant, 'guolu');
  });
});

/**
 * 派工焦段 —— 三级作为**主行集**,不是某一单下面的抽屉。
 * 「这周哪台压机堵了」要能对全场景的火次排序/分组;锁在各自父行的 detail 里查不了。
 */
const WO_PAYLOAD = {
  columns: [
    { key: 'wbs', name: 'WBS', type: 'text' },
    { key: 'op_seq', name: '工序号', type: 'number' },
    { key: 'status', name: '状态', type: 'status', options: ['DONE'], semantics: { DONE: 'positive' } },
  ],
  rows: [
    { wbs: 'W1', op_seq: 10, op_name: '第一火', resource_id: 'DJ0202-2', status: 'DONE' },
    { wbs: 'W2', op_seq: 10, op_name: '精炼', resource_id: 'YZ0202-4', status: 'DONE' },
  ],
  total: 23349,
  tenant: 'shangzhong',
};

describe('importCompassWorkorderSheet: 三级作为焦段主行集', () => {
  it('走数据面拉整场景的三级(不带 wbs/order_id),落进 workorders sheet,盖来源戳', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      urls.push(String(input));
      return fakeResponse(WO_PAYLOAD);
    }) as unknown as typeof fetch;

    const out = await importCompassWorkorderSheet(
      undefined, // getMcpToolsets — REST 路径不许碰 MCP
      {},
      undefined,
      { entryPin: 'compass', projectId: 'p1', rest: { baseUrl: 'http://fake.compass.local', headers: {} } },
      { fetchImpl },
    );

    assert.equal(out.ok, true);
    assert.equal((out as { imported: number }).imported, 2);
    assert.equal(urls.length, 1);
    assert.match(urls[0]!, /\/data\/workorder-rows/);
    assert.doesNotMatch(urls[0]!, /wbs=|order_id=/, '焦段模式不带单据范围,否则就退化成抽屉');

    const meta = getTableSheetMeta(idIn('p1', WORKORDERS_SHEET_ID));
    assert.equal(conn(meta?.source).project, 'p1');
    assert.equal(conn(meta?.source).tenant, 'shangzhong');
    assert.equal(listTableRows(idIn('p1', WORKORDERS_SHEET_ID)).length, 2);
    // 页签上是人话(这是排产的第三个焦段),但 id 保持英文 —— 工具和接口都按 id 引用。
    assert.equal(meta?.name, '派工');
    assert.equal(meta?.id, idIn('p1', 'workorders'));
  });

  it('total 大于装进来的行数时照实报出来 —— 不能让"装了两行"看起来像"一共两行"', async () => {
    const fetchImpl = (async () => fakeResponse(WO_PAYLOAD)) as unknown as typeof fetch;
    const out = await importCompassWorkorderSheet(
      undefined, {}, undefined,
      { entryPin: 'compass', projectId: 'p1', rest: { baseUrl: 'http://x', headers: {} } },
      { fetchImpl },
    );
    assert.equal((out as { total: number }).total, 23349);
    assert.equal((out as { imported: number }).imported, 2);
  });

  it('REST 挂了退回 MCP 的 get_workorder_rows', async () => {
    const fetchImpl = (async () => fakeResponse({}, 500)) as unknown as typeof fetch;
    let mcpArgs: Record<string, unknown> | undefined;
    const getMcpToolsets = () => ({
      compass: {
        get_workorder_rows: {
          execute: async (args: Record<string, unknown>) => {
            mcpArgs = args;
            return { ...WO_PAYLOAD, tenant: 'fallback' };
          },
        },
      },
    });

    const out = await importCompassWorkorderSheet(
      getMcpToolsets, {}, () => ({}),
      { entryPin: 'compass', projectId: 'p2', rest: { baseUrl: 'http://x', headers: {} } },
      { fetchImpl },
    );
    assert.equal(out.ok, true);
    assert.ok(mcpArgs, 'must fall back to the MCP tool');
    assert.equal(mcpArgs!['wbs'], undefined);
  });

  it('没选项目时先被拒,且理由是"没选项目"而不是"没连上"', async () => {
    // 项目数据只能落在项目里(spec §3.4)。以前这里报 not connected —— 原因不对,
    // 人会照着去查连接。
    const out = await importCompassWorkorderSheet(() => ({}), {}, () => ({}), undefined);
    assert.equal(out.ok, false);
    assert.match((out as { error: string }).error, /没有选项目/);
  });

  it('选了项目但没连 compass,才报没连上', async () => {
    const out = await importCompassWorkorderSheet(() => ({}), {}, () => ({}),
                                                  { entryPin: 'compass', projectId: 'p9' });
    assert.equal(out.ok, false);
    assert.match((out as { error: string }).error, /get_workorder_rows/);
  });
});
