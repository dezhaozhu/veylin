import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assistantTurnWorkMs,
  createAssistantTurnTiming,
  reasoningSegmentDurationMs,
  reasoningSegmentKey,
  reduceAssistantTurnTiming,
} from './assistant-turn-timing';

describe('assistant turn timing', () => {
  it('adds active intervals and excludes user waiting time', () => {
    let timing = createAssistantTurnTiming('run-1');
    timing = reduceAssistantTurnTiming(timing, {
      type: 'running',
      runId: 'run-1',
      now: 0,
    });
    timing = reduceAssistantTurnTiming(timing, { type: 'suspended', now: 2_000 });
    timing = reduceAssistantTurnTiming(timing, {
      type: 'resumed',
      runId: 'run-1',
      now: 12_000,
    });
    timing = reduceAssistantTurnTiming(timing, { type: 'finished', now: 14_000 });

    assert.equal(timing.phase, 'finished');
    assert.equal(timing.accumulatedWorkMs, 4_000);
    assert.equal(assistantTurnWorkMs(timing), 4_000);
    assert.equal(timing.segments.length, 2);
  });

  it('keeps independent totals for different runs', () => {
    const first = reduceAssistantTurnTiming(
      reduceAssistantTurnTiming(createAssistantTurnTiming('a'), {
        type: 'running',
        runId: 'a',
        now: 0,
      }),
      { type: 'finished', now: 1_000 },
    );
    const second = reduceAssistantTurnTiming(
      reduceAssistantTurnTiming(createAssistantTurnTiming('b'), {
        type: 'running',
        runId: 'b',
        now: 10_000,
      }),
      { type: 'finished', now: 13_000 },
    );
    assert.equal(first.accumulatedWorkMs, 1_000);
    assert.equal(second.accumulatedWorkMs, 3_000);
  });

  it('keeps reasoning segment durations independent by run step and part', () => {
    const parts = [
      { type: 'step-start' },
      { type: 'reasoning' },
      { type: 'step-start' },
      { type: 'reasoning' },
    ];
    const timing = {
      ...createAssistantTurnTiming('run-1'),
      segments: [
        {
          key: reasoningSegmentKey(parts, 1, 'run-1'),
          kind: 'reasoning' as const,
          startedAt: 0,
          endedAt: 1_000,
          durationMs: 1_000,
        },
        {
          key: reasoningSegmentKey(parts, 3, 'run-1'),
          kind: 'reasoning' as const,
          startedAt: 2_000,
          endedAt: 4_500,
          durationMs: 2_500,
        },
      ],
    };
    assert.equal(reasoningSegmentDurationMs(timing, parts, 1), 1_000);
    assert.equal(reasoningSegmentDurationMs(timing, parts, 3), 2_500);
  });
});
