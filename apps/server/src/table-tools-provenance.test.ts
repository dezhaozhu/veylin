/**
 * Table provenance (Layer-4): sheet metadata gains a `source` stamp on every
 * Compass load, and table_get surfaces it + refuses rows outright when a
 * thread's project pin disagrees with a STAMPED source — the guard against the
 * real incident this closes: a workspace sheet loaded from tenant `shangzhong`
 * days ago being read by an agent in a `guolu`-pinned thread with no signal
 * (or, pre audit-fix-#2, only a soft warning it could ignore) that the rows
 * were stale/cross-tenant. Legacy unstamped sheets keep the softer
 * warn-but-still-return behavior (see the last two tests below).
 *
 * In-memory only (mirrors table-tools.test.ts): DB persistence is fire-and-forget
 * and best-effort here (stampCompassLoadSource swallows persist failures), so no
 * SurrealDB setup is needed. The real DB round-trip lives in
 * table-store-provenance.test.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTableTools } from './table-tools.js';
import {
  buildTableContextBlock,
  createTableSheet,
  formatTableContextBlock,
  getTableSheetMeta,
  isProjectPinMismatch,
} from './table-store.js';

type ToolCtx = { requestContext: { get(key: string): unknown } };

function ctxWithPin(pin: string | null): ToolCtx {
  return { requestContext: { get: (key: string) => (key === 'projectPin' ? pin : undefined) } };
}

type TableGetOut = {
  sheet: string;
  source?: { server: string; tenant?: string; loadedAt: string };
  warning?: string;
  refused?: boolean;
  rows?: unknown[];
};

// table_get's mastra-inferred execute type is a union with `void` / ValidationError
// (same shape TS infers for load_compass_schedule elsewhere in this file, hence the
// existing `as any` casts) — narrow to the shape this suite actually asserts on.
async function callTableGet(
  tools: ReturnType<typeof buildTableTools>,
  input: { sheet: string },
  ctx?: ToolCtx,
): Promise<TableGetOut> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tools.table_get.execute as any)(input, ctx ?? {});
}

function scheduleToolset(tenant?: string) {
  return {
    get_schedule_rows: {
      execute: async () => ({
        columns: [{ key: 'order_id', name: 'order_id', type: 'text' }],
        rows: [{ order_id: 'O1' }],
        total: 1,
        ...(tenant !== undefined ? { tenant } : {}),
      }),
    },
  };
}

describe('table provenance: stamping on Compass (re)load', () => {
  it('stamps server + tenant + loadedAt from the resolved server and payload.tenant', async () => {
    const before = Date.now();
    const getToolsets = () => ({ compass: scheduleToolset('guolu') });
    const tools = buildTableTools(getToolsets);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (tools.load_compass_schedule.execute as any)({});
    assert.equal(out.ok, true);

    const meta = getTableSheetMeta('schedule');
    assert.ok(meta?.source, 'expected sheet meta to carry a source stamp');
    assert.equal(meta!.source!.server, 'compass');
    assert.equal(meta!.source!.tenant, 'guolu');
    assert.ok(
      Date.parse(meta!.source!.loadedAt) >= before,
      `loadedAt ${meta!.source!.loadedAt} should be >= test start`,
    );
  });

  it('stamps the resolved compass-prefixed server name (not a hardcoded "compass")', async () => {
    const getToolsets = () => ({ 'compass-shangzhong': scheduleToolset('shangzhong') });
    const tools = buildTableTools(getToolsets);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.load_compass_schedule.execute as any)({});

    const meta = getTableSheetMeta('schedule');
    assert.equal(meta?.source?.server, 'compass-shangzhong');
    assert.equal(meta?.source?.tenant, 'shangzhong');
  });

  it('omits tenant when the Compass payload carries none', async () => {
    const getToolsets = () => ({ compass: scheduleToolset(undefined) });
    const tools = buildTableTools(getToolsets);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.load_compass_schedule.execute as any)({});

    const meta = getTableSheetMeta('schedule');
    assert.ok(meta?.source);
    assert.equal(meta!.source!.tenant, undefined);
  });

  it('re-stamps loadedAt on a repeat load', async () => {
    const getToolsets = () => ({ compass: scheduleToolset('guolu') });
    const tools = buildTableTools(getToolsets);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.load_compass_schedule.execute as any)({});
    const first = getTableSheetMeta('schedule')!.source!.loadedAt;

    await new Promise((r) => setTimeout(r, 5));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.load_compass_schedule.execute as any)({});
    const second = getTableSheetMeta('schedule')!.source!.loadedAt;

    assert.notEqual(first, second);
  });
});

describe('table_get: source + project-pin mismatch refusal', () => {
  it('surfaces source verbatim and no warning when the thread has no project pin', async () => {
    const getToolsets = () => ({ compass: scheduleToolset('guolu') });
    const tools = buildTableTools(getToolsets);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.load_compass_schedule.execute as any)({});

    const out = await callTableGet(tools, { sheet: 'schedule' });
    assert.ok(out.source);
    assert.equal(out.source!.server, 'compass');
    assert.equal(out.source!.tenant, 'guolu');
    assert.equal('warning' in out, false, 'no pin → no warning');
  });

  it('refuses the rows (no row data) when the sheet source.server differs from the current project pin', async () => {
    const getToolsets = () => ({ 'compass-guolu': scheduleToolset('guolu') });
    const tools = buildTableTools(getToolsets);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.load_compass_schedule.execute as any)({});

    const out = await callTableGet(tools, { sheet: 'schedule' }, ctxWithPin('compass-shangzhong'));
    assert.equal(out.refused, true);
    assert.equal('rows' in out, false, 'refused response must carry no row data');
    assert.equal('source' in out, false, 'refused response must carry no source either');
    assert.match(out.warning ?? '', /^注意:/);
    assert.match(out.warning ?? '', /compass-guolu/);
    assert.match(out.warning ?? '', /guolu/); // tenant
    assert.match(out.warning ?? '', /compass-shangzhong/);
    assert.match(out.warning ?? '', /勿与当前项目的实时数据混用/);
    assert.match(out.warning ?? '', /请在当前项目下重新加载/);
  });

  it('no warning when the sheet source.server matches the current project pin', async () => {
    const getToolsets = () => ({ 'compass-guolu': scheduleToolset('guolu') });
    const tools = buildTableTools(getToolsets);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.load_compass_schedule.execute as any)({});

    const out = await callTableGet(tools, { sheet: 'schedule' }, ctxWithPin('compass-guolu'));
    assert.equal('warning' in out, false);
    assert.equal(out.source!.server, 'compass-guolu');
  });

  it('legacy unstamped sheet under a pin gets the legacy warning, not the mismatch warning — and still returns rows (audit fix #2 refuses only STAMPED mismatches, not unlabeled legacy data)', async () => {
    const created = createTableSheet('legacy-sheet-pin');
    assert.ok(created);
    const tools = buildTableTools();

    const out = await callTableGet(tools, { sheet: created!.id }, ctxWithPin('compass-guolu'));
    assert.equal('source' in out, false);
    assert.equal(out.warning, '本表无来源记录(旧数据), 无法确认属于当前项目');
    assert.equal(out.refused ?? false, false, 'legacy unstamped sheets must not be refused');
    assert.ok(Array.isArray(out.rows), 'legacy unstamped sheets must still return rows');
  });

  it('legacy unstamped sheet with no pin is byte-identical to pre-provenance output (no source, no warning)', async () => {
    const created = createTableSheet('legacy-sheet-nopin');
    assert.ok(created);
    const tools = buildTableTools();

    const out = await callTableGet(tools, { sheet: created!.id });
    assert.equal('source' in out, false);
    assert.equal('warning' in out, false);
  });
});

describe('isProjectPinMismatch', () => {
  it('false with no pin, no source, or a matching source', () => {
    assert.equal(isProjectPinMismatch(undefined, null), false);
    assert.equal(isProjectPinMismatch(undefined, 'compass-guolu'), false, 'legacy unstamped → not a hard mismatch');
    assert.equal(
      isProjectPinMismatch({ server: 'compass-guolu', loadedAt: 'x' }, 'compass-guolu'),
      false,
    );
  });

  it('true only for a STAMPED, differing source', () => {
    assert.equal(
      isProjectPinMismatch({ server: 'compass-guolu', loadedAt: 'x' }, 'compass-shangzhong'),
      true,
    );
  });
});

describe('buildTableContextBlock: pinned mismatch is omitted from the injected prompt block', () => {
  it('formatTableContextBlock replaces a pinMismatch sheet with a one-line note, no row data', () => {
    const block = formatTableContextBlock([
      {
        id: 'sheet-mismatch',
        name: 'Mismatched Sheet',
        columns: [{ key: 'secret', name: 'Secret' }],
        rowCount: 5,
        sampleRows: [{ row_id: 'r1', secret: 'do-not-leak' }],
        pinMismatch: true,
      },
    ]);
    assert.match(block, /跳过: 数据来源与当前项目不一致/);
    assert.match(block, /请在当前项目下重新加载/);
    assert.doesNotMatch(block, /do-not-leak/);
    assert.doesNotMatch(block, /Secret/);
  });

  it('a non-mismatched sheet in the same block renders normally', () => {
    const block = formatTableContextBlock([
      {
        id: 'sheet-ok',
        name: 'OK Sheet',
        columns: [{ key: 'val', name: 'Value' }],
        rowCount: 1,
        sampleRows: [{ row_id: 'r1', val: 'visible-data' }],
      },
    ]);
    assert.match(block, /visible-data/);
  });

  it('buildTableContextBlock end-to-end: a stamped-mismatched sheet is omitted, a matching one is not', async () => {
    const getToolsets = () => ({ 'compass-guolu': scheduleToolset('guolu') });
    const tools = buildTableTools(getToolsets);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.load_compass_schedule.execute as any)({});

    const meta = getTableSheetMeta('schedule');
    assert.equal(meta?.source?.server, 'compass-guolu');

    const mismatchedBlock = buildTableContextBlock(null, 'compass-shangzhong');
    assert.match(mismatchedBlock, /跳过: 数据来源与当前项目不一致/);
    assert.doesNotMatch(mismatchedBlock, /O1/); // the seeded row's order_id

    const matchingBlock = buildTableContextBlock(null, 'compass-guolu');
    assert.doesNotMatch(matchingBlock, /跳过:/);
  });
});
