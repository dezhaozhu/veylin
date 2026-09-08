import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareRuns, shortRunId } from './run-mismatch';

describe('compareRuns — 跨面版本比对是三态', () => {
  it('两边都知道且相同 → same;不同 → differs', () => {
    assert.equal(compareRuns('tenantrun-2026-08-18T17:56:01', 'tenantrun-2026-08-18T17:56:01'), 'same');
    assert.equal(compareRuns('tenantrun-2026-08-18T17:56:01', 'tenantrun-2026-09-08T09:00:00'), 'differs');
  });
  it('任一侧不知道 → unknown(不当一致也不当不一致)', () => {
    assert.equal(compareRuns(undefined, 'r1'), 'unknown');
    assert.equal(compareRuns('r1', null), 'unknown');
    assert.equal(compareRuns('', ''), 'unknown');
  });
});

describe('shortRunId', () => {
  it('从 run id 里抽出 月-日 时:分', () => {
    assert.equal(shortRunId('tenantrun-2026-08-18T17:56:01.249392'), '08-18 17:56');
  });
  it('认不出就原样,空就空', () => {
    assert.equal(shortRunId('run-7'), 'run-7');
    assert.equal(shortRunId(undefined), '');
  });
});
