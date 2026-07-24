/**
 * load_compass_* agent tools follow the CHAT REQUEST's project pin: they read
 * `requestContext.get('projectPin')` (set by routes/chat.ts from the thread's
 * resolved pin — see resolveTablesPin's twin logic in routes/chat.ts) instead
 * of always resolving unpinned (`pin: null`), so a grouped Compass deployment
 * picks the CURRENTLY OPEN thread's pinned member during a chat turn instead
 * of refusing under ambiguity — the same fix routes/tables.ts's HTTP routes
 * get from `resolveThreadPin` (see routes/tables-thread-pin.test.ts), applied
 * at the tool-execute seam. Mirrors table-tools-provenance.test.ts's
 * `ctxWithPin` helper and in-memory (no DB) setup.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTableTools } from './table-tools.js';
import { getTableSheetMeta } from './table-store.js';

type ToolCtx = { requestContext: { get(key: string): unknown } };

function ctxWithPin(pin: string | null): ToolCtx {
  return { requestContext: { get: (key: string) => (key === 'projectPin' ? pin : undefined) } };
}

function scheduleToolset(tenant?: string) {
  return {
    get_schedule_rows: {
      execute: async () => ({
        columns: [{ key: 'order_id', name: 'order_id', type: 'text' }],
        rows: [{ order_id: 'O1', product_class: 'x' }],
        total: 1,
        ...(tenant !== undefined ? { tenant } : {}),
      }),
    },
  };
}

function resourcesToolset(tenant?: string) {
  return {
    get_resources: {
      execute: async () => ({
        resources: [{ resource: 'R1', current_k: 1 }],
        ...(tenant !== undefined ? { tenant } : {}),
      }),
    },
  };
}

// mastra-inferred execute types are unions with `void`/ValidationError (same
// shape table-tools-provenance.test.ts casts around) — narrow to the ok/error
// shape this suite asserts on.
type LoadOut = { ok: boolean; error?: string };

async function callLoadTool(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: any,
  ctx?: ToolCtx,
): Promise<LoadOut> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tool.execute as any)({}, ctx ?? {});
}

describe('load_compass_schedule: resolves Compass through requestContext projectPin', () => {
  it('two grouped compass-prefixed servers + a matching pin: resolves the pinned member (stamps its name as source)', async () => {
    const suffix = Date.now();
    const pinned = `compass-guolu-${suffix}`;
    const other = `compass-shangzhong-${suffix}`;
    const getToolsets = () => ({
      [pinned]: scheduleToolset('guolu'),
      [other]: scheduleToolset('shangzhong'),
    });
    const getMcpGroups = () => ({ [pinned]: 'compass', [other]: 'compass' });
    const tools = buildTableTools(getToolsets, getMcpGroups);

    const out = await callLoadTool(tools.load_compass_schedule, ctxWithPin(pinned));
    assert.equal(out.ok, true);
    const meta = getTableSheetMeta('schedule');
    assert.equal(meta?.source?.server, pinned, 'must resolve via the requestContext pin, not guess');
    assert.equal(meta?.source?.tenant, 'guolu');
  });

  it('two grouped compass-prefixed servers + no pin on requestContext at all: refuses (today\'s ambiguity refusal, unchanged)', async () => {
    const suffix = Date.now() + 1;
    const a = `compass-guolu-${suffix}`;
    const b = `compass-shangzhong-${suffix}`;
    const getToolsets = () => ({ [a]: scheduleToolset('guolu'), [b]: scheduleToolset('shangzhong') });
    const getMcpGroups = () => ({ [a]: 'compass', [b]: 'compass' });
    const tools = buildTableTools(getToolsets, getMcpGroups);

    // No ctx at all — mirrors a tool invoked outside a requestContext-carrying chat turn.
    const out = await callLoadTool(tools.load_compass_schedule);
    assert.equal(out.ok, false);
    assert.match(out.error ?? '', /not connected/);
  });

  it('pin names a server that is NOT connected: falls through to ambiguity refusal (never guesses a different member)', async () => {
    const suffix = Date.now() + 2;
    const a = `compass-guolu-${suffix}`;
    const b = `compass-shangzhong-${suffix}`;
    const getToolsets = () => ({ [a]: scheduleToolset('guolu'), [b]: scheduleToolset('shangzhong') });
    const getMcpGroups = () => ({ [a]: 'compass', [b]: 'compass' });
    const tools = buildTableTools(getToolsets, getMcpGroups);

    const out = await callLoadTool(tools.load_compass_schedule, ctxWithPin('compass-not-connected'));
    assert.equal(out.ok, false);
  });
});

describe('load_compass_orders / load_compass_resources: same requestContext pin resolution', () => {
  it('load_compass_orders resolves via the pin under two grouped servers', async () => {
    const suffix = Date.now() + 3;
    const pinned = `compass-guolu-${suffix}`;
    const other = `compass-shangzhong-${suffix}`;
    const getToolsets = () => ({
      [pinned]: scheduleToolset('guolu'),
      [other]: scheduleToolset('shangzhong'),
    });
    const getMcpGroups = () => ({ [pinned]: 'compass', [other]: 'compass' });
    const tools = buildTableTools(getToolsets, getMcpGroups);

    const out = await callLoadTool(tools.load_compass_orders, ctxWithPin(pinned));
    assert.equal(out.ok, true);
    const meta = getTableSheetMeta('orders');
    assert.equal(meta?.source?.server, pinned);
  });

  it('load_compass_resources resolves via the pin under two grouped servers', async () => {
    const suffix = Date.now() + 4;
    const pinned = `compass-guolu-${suffix}`;
    const other = `compass-shangzhong-${suffix}`;
    const getToolsets = () => ({
      [pinned]: resourcesToolset('guolu'),
      [other]: resourcesToolset('shangzhong'),
    });
    const getMcpGroups = () => ({ [pinned]: 'compass', [other]: 'compass' });
    const tools = buildTableTools(getToolsets, getMcpGroups);

    const out = await callLoadTool(tools.load_compass_resources, ctxWithPin(pinned));
    assert.equal(out.ok, true);
    const meta = getTableSheetMeta('resources');
    assert.equal(meta?.source?.server, pinned);
  });
});
