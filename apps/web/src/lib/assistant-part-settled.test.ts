import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findFoldedPrefixEnd,
  findTrailingVisiblePartIndex,
  resolveAssistantRunPhase,
  shouldFoldAssistantWork,
  shouldShowAssistantFooter,
} from './assistant-part-settled';

describe('findFoldedPrefixEnd', () => {
  const parts = [
    { type: 'step-start' },
    { type: 'reasoning' },
    { type: 'tool-table_get', toolCallId: 'table-1' },
    { type: 'step-start' },
    { type: 'text' },
    { type: 'tool-ask_user_question', toolCallId: 'ask-1' },
    {
      type: 'data-tool-call-suspended',
      data: { runId: 'run-1', toolCallId: 'ask-1' },
    },
  ];

  it('folds only completed steps while waiting on the user', () => {
    assert.equal(findFoldedPrefixEnd(parts, 'waiting_user'), 3);
  });

  it('folds all pre-final work after the run finishes', () => {
    assert.equal(findFoldedPrefixEnd(parts, 'finished'), parts.length);
    assert.equal(findFoldedPrefixEnd(parts, 'failed'), parts.length);
  });

  it('keeps the current running step expanded', () => {
    assert.equal(findFoldedPrefixEnd(parts.slice(0, 5), 'working'), 3);
    assert.equal(findFoldedPrefixEnd(parts.slice(0, 3), 'working'), 0);
  });
});

describe('findTrailingVisiblePartIndex', () => {
  it('returns the last non-structural part', () => {
    assert.equal(
      findTrailingVisiblePartIndex([
        { type: 'reasoning' },
        { type: 'tool-call', toolName: 'table_get' },
        { type: 'step-start' },
      ]),
      1,
    );
  });

  it('returns -1 when there is nothing to show', () => {
    assert.equal(findTrailingVisiblePartIndex([{ type: 'step-start' }]), -1);
    assert.equal(findTrailingVisiblePartIndex([]), -1);
  });
});

describe('resolveAssistantRunPhase', () => {
  it('forces non-last stuck phases to finished', () => {
    for (const recordedPhase of [
      'idle',
      'working',
      'waiting_user',
      'finished',
      undefined,
    ] as const) {
      assert.equal(
        resolveAssistantRunPhase({
          recordedPhase,
          isLastMessage: false,
          threadIsRunning: true,
        }),
        'finished',
      );
    }
  });

  it('preserves failed on historical messages', () => {
    assert.equal(
      resolveAssistantRunPhase({
        recordedPhase: 'failed',
        isLastMessage: false,
        threadIsRunning: false,
      }),
      'failed',
    );
  });

  it('trusts the recorded phase on the last message', () => {
    assert.equal(
      resolveAssistantRunPhase({
        recordedPhase: 'waiting_user',
        isLastMessage: true,
        threadIsRunning: false,
      }),
      'waiting_user',
    );
    assert.equal(
      resolveAssistantRunPhase({
        recordedPhase: 'working',
        isLastMessage: true,
        threadIsRunning: true,
      }),
      'working',
    );
  });

  it('falls back from missing phase on the last message', () => {
    assert.equal(
      resolveAssistantRunPhase({
        isLastMessage: true,
        threadIsRunning: true,
      }),
      'working',
    );
    assert.equal(
      resolveAssistantRunPhase({
        isLastMessage: true,
        threadIsRunning: false,
      }),
      'finished',
    );
  });
});

describe('shouldShowAssistantFooter', () => {
  it('shows only after the turn ends', () => {
    assert.equal(shouldShowAssistantFooter('finished'), true);
    assert.equal(shouldShowAssistantFooter('failed'), true);
    assert.equal(shouldShowAssistantFooter('waiting_user'), false);
    assert.equal(shouldShowAssistantFooter('working'), false);
    assert.equal(shouldShowAssistantFooter('idle'), false);
  });
});

describe('shouldFoldAssistantWork', () => {
  it('folds finished history whenever there is pre-final work', () => {
    assert.equal(
      shouldFoldAssistantWork({
        phase: 'finished',
        foldedPrefixEnd: 0,
        hasPreFinalWork: true,
      }),
      true,
    );
    assert.equal(
      shouldFoldAssistantWork({
        phase: 'failed',
        foldedPrefixEnd: 0,
        hasPreFinalWork: true,
      }),
      true,
    );
    assert.equal(
      shouldFoldAssistantWork({
        phase: 'finished',
        foldedPrefixEnd: 4,
        hasPreFinalWork: false,
      }),
      false,
    );
  });

  it('folds in-progress turns only when a completed prefix exists', () => {
    assert.equal(
      shouldFoldAssistantWork({
        phase: 'waiting_user',
        foldedPrefixEnd: 3,
        hasPreFinalWork: false,
      }),
      true,
    );
    assert.equal(
      shouldFoldAssistantWork({
        phase: 'working',
        foldedPrefixEnd: 0,
        hasPreFinalWork: true,
      }),
      false,
    );
  });
});
