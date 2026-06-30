/**
 * Unit tests for buildTableTools — specifically the load_compass_schedule tool.
 *
 * The table store is an in-memory singleton. DB persistence calls (tablePersist) are
 * fire-and-forget and fail silently when no SurrealDB is available, so in-memory
 * assertions work fine without any DB setup.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTableTools } from './table-tools.js';
import { listTableRows, listTableColumns } from './table-store.js';

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
    const out = await (tools.load_compass_schedule.execute as any)({ limit: 100 });

    assert.equal(out.ok, true);
    assert.equal(out.sheet, 'schedule');
    assert.equal(out.imported, 2);

    // Verify the in-memory store was populated.
    const rows = listTableRows('schedule');
    assert.equal(rows.length, 2);
    const cols = listTableColumns('schedule');
    assert.equal(cols.length, 2);
  });

  it('errors cleanly when no compass MCP server is connected', async () => {
    const tools = buildTableTools(() => ({})); // no compass toolset
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (tools.load_compass_schedule.execute as any)({});

    assert.equal(out.ok, false);
    assert.match(String(out.error), /compass|not connected|get_schedule_rows/i);
  });
});
