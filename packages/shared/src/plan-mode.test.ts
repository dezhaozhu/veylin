import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ENTER_PLAN_MODE_TOOL,
  EXIT_PLAN_MODE_TOOL,
  inferPlanModeFromMessages,
  inferPlanModeFromThreadMessages,
} from './plan-mode.js';

describe('plan-mode constants', () => {
  it('exports enter and exit tool names', () => {
    assert.equal(ENTER_PLAN_MODE_TOOL, 'enter_plan_mode');
    assert.equal(EXIT_PLAN_MODE_TOOL, 'exit_plan_mode');
  });
});

describe('inferPlanModeFromMessages', () => {
  it('returns null when no plan tools', () => {
    assert.equal(
      inferPlanModeFromMessages([{ role: 'assistant', parts: [{ type: 'text', text: 'hi' }] }]),
      null,
    );
  });

  it('tracks enter then exit', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          { type: `tool-${ENTER_PLAN_MODE_TOOL}`, state: 'output-available', output: { planMode: true } },
          { type: `tool-${EXIT_PLAN_MODE_TOOL}`, state: 'output-available', output: { planMode: false } },
        ],
      },
    ];
    assert.equal(inferPlanModeFromMessages(messages), false);
  });
});

describe('inferPlanModeFromThreadMessages', () => {
  it('returns true after enter_plan_mode tool-call', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolName: ENTER_PLAN_MODE_TOOL, result: { planMode: true } },
        ],
      },
    ];
    assert.equal(inferPlanModeFromThreadMessages(messages), true);
  });

  it('returns null when no plan tools', () => {
    assert.equal(
      inferPlanModeFromThreadMessages([{ role: 'user', content: [] }]),
      null,
    );
  });
});
