/**
 * Unit tests for the /api/schedule-edit proxy helpers. Fake the Compass MCP
 * toolset exactly like table-tools.test.ts — no DB, no network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  proposeScheduleEdit,
  previewScheduleEdit,
  commitScheduleEdit,
  discardScheduleEdits,
  scheduleEditGuidanceBlock,
  unwrapMcpResult,
} from './schedule-edit.js';

const toolsetsWith = (tools: Record<string, (args: unknown) => Promise<unknown>>) => () => ({
  compass: Object.fromEntries(
    Object.entries(tools).map(([name, fn]) => [name, { execute: fn }]),
  ),
});

describe('unwrapMcpResult', () => {
  it('passes a direct typed object through', () => {
    assert.deepEqual(unwrapMcpResult({ ops: 2, note: 'n' }), { ops: 2, note: 'n' });
  });
  it('parses content[0].text JSON', () => {
    assert.deepEqual(
      unwrapMcpResult({ content: [{ type: 'text', text: '{"ops":3}' }] }),
      { ops: 3 },
    );
  });
  it('returns {} on garbage', () => {
    assert.deepEqual(unwrapMcpResult({ content: [{ text: 'not json' }] }), {});
  });
});

describe('proposeScheduleEdit', () => {
  it('forwards the body and returns ops', async () => {
    let seen: unknown = null;
    const get = toolsetsWith({
      propose_schedule_edit: async (args) => {
        seen = args;
        return { ops: 1, note: '已加入草稿' };
      },
    });
    const out = await proposeScheduleEdit(get, {
      field: 'std_duration_days',
      job_id: 'J1',
      value: 5,
    });
    assert.deepEqual(seen, { field: 'std_duration_days', job_id: 'J1', value: 5 });
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.ops, 1);
  });

  it('maps refused → ok:false refused', async () => {
    const get = toolsetsWith({
      propose_schedule_edit: async () => ({ refused: '需要 central 角色' }),
    });
    const out = await proposeScheduleEdit(get, { field: 'resource', job_id: 'J1', value: 'M1' });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(String(out.refused), /central/);
  });

  it('errors cleanly when compass is not connected', async () => {
    const out = await proposeScheduleEdit(() => ({}), { field: 'resource', job_id: 'J1', value: 'M1' });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(String(out.error), /not connected/);
  });
});

describe('previewScheduleEdit', () => {
  it('returns rows + diagnosis', async () => {
    const get = toolsetsWith({
      preview_schedule_edit: async () => ({
        rows: [{ order_id: 'O1', schedule_status: 'late' }],
        diagnosis: { honest_status: 'feasible', unscheduled: 0 },
      }),
    });
    const out = await previewScheduleEdit(get);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.rows.length, 1);
      assert.equal(out.diagnosis['honest_status'], 'feasible');
    }
  });
});

describe('commitScheduleEdit', () => {
  it('passes the commit summary through', async () => {
    const get = toolsetsWith({
      commit_schedule_edit: async () => ({
        committed: 2, deferred: 1, proposal_ids: ['p1'], deferred_ids: ['due O1'],
        run_id: 'r9', status: 'feasible', unscheduled: 0,
      }),
    });
    const out = await commitScheduleEdit(get);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.committed, 2);
      assert.equal(out.deferred, 1);
      assert.deepEqual(out.proposal_ids, ['p1']);
      assert.deepEqual(out.deferred_ids, ['due O1']);
      assert.equal(out.status, 'feasible');
    }
  });

  it('maps conflict → ok:false conflict:true', async () => {
    const get = toolsetsWith({
      commit_schedule_edit: async () => ({
        conflict: true, error: 'draft base stale', note: '请重新 preview',
      }),
    });
    const out = await commitScheduleEdit(get);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.conflict, true);
  });
});

describe('discardScheduleEdits', () => {
  it('returns ok on discarded:true', async () => {
    const get = toolsetsWith({ discard_schedule_edits: async () => ({ discarded: true }) });
    const out = await discardScheduleEdits(get);
    assert.equal(out.ok, true);
  });
});

describe('scheduleEditGuidanceBlock', () => {
  it('is empty without compass propose tool', () => {
    assert.equal(scheduleEditGuidanceBlock(() => ({})), '');
  });
  it('mentions the four-step loop when connected', () => {
    const get = toolsetsWith({ propose_schedule_edit: async () => ({}) });
    const block = scheduleEditGuidanceBlock(get);
    assert.match(block, /propose_schedule_edit/);
    assert.match(block, /preview_schedule_edit/);
    assert.match(block, /commit_schedule_edit/);
    assert.match(block, /discard_schedule_edits/);
  });
});
