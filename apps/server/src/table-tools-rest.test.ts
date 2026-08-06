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
import {
  importCompassScheduleSheet,
  importCompassOrderSheet,
  SCHEDULE_SHEET_ID,
  ORDERS_SHEET_ID,
} from './table-tools.js';
import { getTableSheetMeta } from './table-store.js';

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

    const meta = getTableSheetMeta(SCHEDULE_SHEET_ID);
    assert.ok(meta?.source);
    assert.equal(meta!.source!.project, 'p1');
    assert.equal(meta!.source!.tenant, 'guolu');
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

    const meta = getTableSheetMeta(SCHEDULE_SHEET_ID);
    assert.equal(meta?.source?.project, 'p3');
    assert.equal(meta?.source?.tenant, 'no-rest-tenant');
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

    const meta = getTableSheetMeta(ORDERS_SHEET_ID);
    assert.ok(meta?.source);
    assert.equal(meta!.source!.project, 'p1');
    assert.equal(meta!.source!.tenant, 'guolu');
  });
});
