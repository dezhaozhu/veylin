import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planModePolicy, evaluateTool } from './index.js';

describe('planModePolicy', () => {
  it('allows read-only and plan tools', () => {
    assert.equal(evaluateTool('web_fetch', planModePolicy), 'allow');
    assert.equal(evaluateTool('read_open_page', planModePolicy), 'allow');
    assert.equal(evaluateTool('enter_plan_mode', planModePolicy), 'allow');
    assert.equal(evaluateTool('exit_plan_mode', planModePolicy), 'allow');
    assert.equal(evaluateTool('skill', planModePolicy), 'allow');
  });

  it('denies mutating tools', () => {
    assert.equal(evaluateTool('web_fetch', planModePolicy), 'allow');
    assert.equal(evaluateTool('todo_write', planModePolicy), 'allow');
    assert.equal(evaluateTool('unknown_tool', planModePolicy), 'deny');
  });
});
