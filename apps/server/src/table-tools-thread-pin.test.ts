/**
 * load_compass_* agent tools follow the CHAT REQUEST's project scope
 * (project-cognition v3, Phase B 5c re-key): they resolve Compass from
 * `requestContext.get('scopedMcpToolsets')` — the turn's final per-request
 * toolset record (project-scoped + mcpEnabled-filtered + POOLED compass
 * overlay, set by routes/chat.ts) — with the entry-level pin from
 * `requestContext.get('pinnedProjectScope')`, instead of the tenant-level
 * toolset getter. The pre-re-key semantics carry over one-for-one:
 *  - a pinned chat turn resolves ITS request's compass toolset (was: "the
 *    pinned member"), never another project's;
 *  - no requestContext at all keeps today's tenant-getter fallback and the
 *    ambiguity refusal;
 *  - a scope whose record does NOT contain compass (denied pin, explicit
 *    off, pool failure) refuses — it never guesses or falls back to the
 *    tenant cache (plan risk #2: post-Task-4 that cache cannot contain
 *    compass anyway).
 * Provenance: the stamp's durable identity is `source.project` = the pinned
 * PROJECT id (plan risk #1: never the resolved toolset key). Mirrors
 * table-tools-provenance.test.ts's in-memory (no DB) setup.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTableTools } from './table-tools.js';
import { getTableSheetMeta } from './table-store.js';

type ToolCtx = { requestContext: { get(key: string): unknown } };

/** Mirrors the requestContext surface routes/chat.ts sets for a chat turn. */
function ctxWithScope(opts: {
  toolsets?: Record<string, unknown>;
  projectId?: string | null;
  entryPin?: string | null;
}): ToolCtx {
  const values: Record<string, unknown> = {
    scopedMcpToolsets: opts.toolsets,
    pinnedProjectScope:
      opts.projectId != null
        ? { id: opts.projectId, entryPin: opts.entryPin ?? 'compass' }
        : null,
    projectPin: opts.projectId ?? null,
  };
  return { requestContext: { get: (key: string) => values[key] } };
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

describe('load_compass_schedule: resolves Compass through the request-scoped toolsets + project scope', () => {
  it('pinned chat turn: resolves the SCOPED (pooled) record — never the tenant getter — and stamps the PROJECT id', async () => {
    const suffix = Date.now();
    const projectId = `proj-guolu-${suffix}`;
    // Tenant-level getter deliberately carries a compass key with a DIFFERENT
    // tenant flavor: if resolution ever fell back past the request-scoped
    // record, the stamp's tenant would betray it.
    const getToolsets = () => ({ compass: scheduleToolset('tenant-cache-WRONG') });
    const getMcpGroups = () => ({ compass: 'compass-proj' });
    const tools = buildTableTools(getToolsets, getMcpGroups);

    const out = await callLoadTool(
      tools.load_compass_schedule,
      ctxWithScope({
        toolsets: { compass: scheduleToolset('guolu') },
        projectId,
        entryPin: 'compass',
      }),
    );
    assert.equal(out.ok, true);
    const meta = getTableSheetMeta('schedule');
    assert.equal(meta?.source?.tenant, 'guolu', 'must resolve via the request-scoped record');
    assert.equal(meta?.source?.server, 'compass', 'toolset key kept for display only');
    assert.equal(meta?.source?.project, projectId, 'durable identity = the PROJECT id (risk #1)');
  });

  it('no requestContext at all: tenant-getter fallback keeps today\'s grouped-ambiguity refusal', async () => {
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

  it('compass absent from the request-scoped record (denied/off/pool failure): refuses — never resurrects the tenant cache', async () => {
    const suffix = Date.now() + 2;
    // The tenant getter HAS a resolvable compass — but the request record is
    // authoritative and does not contain it (e.g. the pool failed for this
    // turn, so routes/chat.ts dropped compass from agentMcp).
    const getToolsets = () => ({ compass: scheduleToolset('guolu') });
    const getMcpGroups = () => ({ compass: 'compass-proj' });
    const tools = buildTableTools(getToolsets, getMcpGroups);

    const out = await callLoadTool(
      tools.load_compass_schedule,
      ctxWithScope({ toolsets: {}, projectId: `proj-guolu-${suffix}`, entryPin: 'compass' }),
    );
    assert.equal(out.ok, false, 'must refuse rather than fall back past the scoped record');
    assert.match(out.error ?? '', /not connected/);
  });
});

describe('load_compass_orders / load_compass_resources: same request-scope resolution + project stamp', () => {
  it('load_compass_orders resolves the scoped record and stamps the project id', async () => {
    const suffix = Date.now() + 3;
    const projectId = `proj-guolu-${suffix}`;
    const getToolsets = () => ({ compass: scheduleToolset('tenant-cache-WRONG') });
    const getMcpGroups = () => ({ compass: 'compass-proj' });
    const tools = buildTableTools(getToolsets, getMcpGroups);

    const out = await callLoadTool(
      tools.load_compass_orders,
      ctxWithScope({
        toolsets: { compass: scheduleToolset('guolu') },
        projectId,
        entryPin: 'compass',
      }),
    );
    assert.equal(out.ok, true);
    const meta = getTableSheetMeta('orders');
    assert.equal(meta?.source?.tenant, 'guolu');
    assert.equal(meta?.source?.project, projectId);
  });

  it('load_compass_resources resolves the scoped record and stamps the project id', async () => {
    const suffix = Date.now() + 4;
    const projectId = `proj-shangzhong-${suffix}`;
    const getToolsets = () => ({ compass: resourcesToolset('tenant-cache-WRONG') });
    const getMcpGroups = () => ({ compass: 'compass-proj' });
    const tools = buildTableTools(getToolsets, getMcpGroups);

    const out = await callLoadTool(
      tools.load_compass_resources,
      ctxWithScope({
        toolsets: { compass: resourcesToolset('shangzhong') },
        projectId,
        entryPin: 'compass',
      }),
    );
    assert.equal(out.ok, true);
    const meta = getTableSheetMeta('resources');
    assert.equal(meta?.source?.tenant, 'shangzhong');
    assert.equal(meta?.source?.project, projectId);
  });
});
