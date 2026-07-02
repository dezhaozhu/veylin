import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGovernedEditBody, GOVERNED_EDIT_FIELDS } from './schedule-edit.js';

describe('buildGovernedEditBody', () => {
  const row = { job_id: 'J1', order_id: 'O1', resource: 'M1', std_duration_days: 3, due_at: '2026-08-01' };

  it('covers exactly the four governed fields', () => {
    assert.deepEqual(
      [...GOVERNED_EDIT_FIELDS].sort(),
      ['due_at', 'is_bottleneck', 'resource', 'std_duration_days'],
    );
  });

  it('job-level fields carry job_id', () => {
    assert.deepEqual(buildGovernedEditBody(row, 'resource', 'M2'), {
      field: 'resource', job_id: 'J1', value: 'M2',
    });
  });

  it('std_duration_days coerces to number', () => {
    assert.deepEqual(buildGovernedEditBody(row, 'std_duration_days', '5'), {
      field: 'std_duration_days', job_id: 'J1', value: 5,
    });
  });

  it('is_bottleneck coerces truthy strings to boolean true', () => {
    assert.deepEqual(buildGovernedEditBody(row, 'is_bottleneck', '是'), {
      field: 'is_bottleneck', job_id: 'J1', value: true,
    });
  });

  it('is_bottleneck coerces other strings to boolean false', () => {
    assert.deepEqual(buildGovernedEditBody(row, 'is_bottleneck', 'false'), {
      field: 'is_bottleneck', job_id: 'J1', value: false,
    });
  });

  it('due_at carries order_id', () => {
    assert.deepEqual(buildGovernedEditBody(row, 'due_at', '2026-09-01'), {
      field: 'due_at', order_id: 'O1', value: '2026-09-01',
    });
  });

  it('returns null for non-governed columns', () => {
    assert.equal(buildGovernedEditBody(row, 'schedule_status', 'late'), null);
  });

  it('returns null when the row id is missing', () => {
    assert.equal(buildGovernedEditBody({ order_id: 'O1' }, 'resource', 'M2'), null);
    assert.equal(buildGovernedEditBody({ job_id: 'J1' }, 'due_at', '2026-09-01'), null);
  });
});
