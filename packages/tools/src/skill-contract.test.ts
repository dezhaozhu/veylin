import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTER_PLAN_MODE_TOOL } from '@veylin/shared';

describe('skill tool contract', () => {
  it('enter_plan_mode id matches shared constant', () => {
    assert.equal(ENTER_PLAN_MODE_TOOL, 'enter_plan_mode');
  });
});
