import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clampLoopWakeupSeconds,
  formatIntervalSeconds,
  parseIntervalToSeconds,
  isGoalActive,
  isLoopActive,
} from '@veylin/shared';
import { buildGoalBlock, buildLoopBlock, appendPendingLoopTurnNote } from './goal-loop-blocks.js';
import { summarizeMessagesForGoalEval } from './goal-evaluator.js';

describe('goal-loop helpers', () => {
  it('parses interval strings', () => {
    assert.equal(parseIntervalToSeconds('5m'), 300);
    assert.equal(parseIntervalToSeconds('2h'), 7200);
    assert.equal(parseIntervalToSeconds('30s'), 30);
    assert.equal(parseIntervalToSeconds('bad'), null);
  });

  it('formats and clamps wakeup', () => {
    assert.equal(formatIntervalSeconds(300), '5m');
    assert.equal(clampLoopWakeupSeconds(10), 15);
    assert.equal(clampLoopWakeupSeconds(99999), 3600);
  });

  it('detects active goal/loop', () => {
    assert.equal(isGoalActive({ status: 'active' } as never), true);
    assert.equal(isGoalActive({ status: 'achieved' } as never), false);
    assert.equal(isLoopActive({ status: 'active' } as never), true);
    assert.equal(isLoopActive({ status: 'stopped' } as never), false);
  });
});

describe('goal-loop blocks', () => {
  it('builds goal reminder when active', () => {
    const block = buildGoalBlock({
      condition: 'tests pass',
      status: 'active',
      turnsEvaluated: 1,
      maxTurns: 100,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastEvalReason: 'still failing',
    });
    assert.match(block, /tests pass/);
    assert.match(block, /still failing/);
    assert.match(block, /system-reminder/);
  });

  it('omits inactive goal', () => {
    assert.equal(buildGoalBlock(null), '');
    assert.equal(
      buildGoalBlock({
        condition: 'x',
        status: 'cleared',
        turnsEvaluated: 0,
        maxTurns: 100,
        startedAt: '',
        updatedAt: '',
      }),
      '',
    );
  });

  it('builds loop reminder for dynamic mode', () => {
    const block = buildLoopBlock({
      prompt: 'check deploy',
      mode: 'dynamic',
      jobId: 'abc',
      status: 'active',
      maxAgeDays: 7,
      createdAt: new Date().toISOString(),
    });
    assert.match(block, /check deploy/);
    assert.match(block, /loop_schedule_wakeup/);
  });

  it('appends pending-loop analysis note to last user turn', () => {
    const messages = appendPendingLoopTurnNote([
      { role: 'user', content: '检查 CI' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: '继续' },
    ]);
    assert.equal(messages[0]?.content, '检查 CI');
    assert.match(String(messages[2]?.content), /Loop mode is armed/);
    assert.match(String(messages[2]?.content), /loop_set/);
    assert.doesNotMatch(String(messages[2]?.content), /system-reminder/);
  });
});

describe('goal evaluator transcript summary', () => {
  it('summarizes text and tool parts', () => {
    const summary = summarizeMessagesForGoalEval([
      { role: 'user', content: 'fix auth' },
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: 'running tests' },
          { type: 'tool-bash', toolName: 'bash', output: { exitCode: 0 } },
        ],
      },
    ]);
    assert.match(summary, /fix auth/);
    assert.match(summary, /running tests/);
    assert.match(summary, /bash/);
  });
});
