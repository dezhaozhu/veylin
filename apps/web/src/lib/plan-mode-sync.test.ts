import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  inferPlanModeFromMessages,
  inferPlanModeFromThreadMessages,
} from './plan-mode-sync';

describe('inferPlanModeFromMessages', () => {
  it('returns null when no plan tools ran', () => {
    assert.equal(
      inferPlanModeFromMessages([{ role: 'assistant', parts: [{ type: 'text', text: 'hi' }] }]),
      null,
    );
  });

  it('tracks the latest enter/exit tool in order', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-enter_plan_mode',
            state: 'output-available',
            output: { planMode: true },
          },
        ],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-exit_plan_mode',
            state: 'output-available',
            output: { planMode: false },
          },
        ],
      },
    ];
    assert.equal(inferPlanModeFromMessages(messages), false);
  });
});

describe('inferPlanModeFromThreadMessages', () => {
  it('reads tool-call results from assistant-ui thread messages', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolName: 'enter_plan_mode',
            result: { planMode: true },
          },
        ],
      },
    ];
    assert.equal(inferPlanModeFromThreadMessages(messages), true);
  });

  it('ignores tool calls without results', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolName: 'enter_plan_mode' }],
      },
    ];
    assert.equal(inferPlanModeFromThreadMessages(messages), null);
  });
});
