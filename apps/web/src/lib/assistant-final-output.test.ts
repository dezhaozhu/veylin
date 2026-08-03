import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findFinalProseIndex,
  findLastFrontendSuspendToolIndex,
  findLastSubstantialTextIndex,
  hasPreFinalWork,
  isFinalProsePart,
  isSubstantialTextPart,
} from './assistant-final-output.js';
import {
  isFrontendSuspendPartsSettled,
  isFrontendSuspendTurnSettled,
  needsFrontendSuspendContinuation,
} from './frontend-suspend-tools.js';
import type { UIMessage } from 'ai';

describe('assistant-final-output', () => {
  it('detects substantial text parts', () => {
    assert.equal(isSubstantialTextPart({ type: 'text', text: '  hi  ' }), true);
    assert.equal(isSubstantialTextPart({ type: 'text', text: '   ' }), false);
    assert.equal(isSubstantialTextPart({ type: 'reasoning', text: 'x' }), false);
  });

  it('finds the last substantial text index', () => {
    const parts = [
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: 'mid' },
      { type: 'tool-call' },
      { type: 'text', text: 'final' },
      { type: 'text', text: '  ' },
    ];
    assert.equal(findLastSubstantialTextIndex(parts), 3);
    assert.equal(findLastSubstantialTextIndex([{ type: 'tool-call' }]), -1);
  });

  it('detects pre-final work', () => {
    assert.equal(
      hasPreFinalWork([
        { type: 'reasoning', text: 't' },
        { type: 'text', text: 'answer' },
      ]),
      true,
    );
    assert.equal(hasPreFinalWork([{ type: 'text', text: 'only' }]), false);
    assert.equal(
      hasPreFinalWork([
        { type: 'text', text: 'mid' },
        { type: 'tool-call' },
        { type: 'text', text: 'final' },
      ]),
      true,
    );
  });

  it('keeps only text after ask as final prose', () => {
    const parts = [
      { type: 'text', text: '先看一下表格' },
      { type: 'tool-ask_user_question' },
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: '最终方案如下' },
    ];
    assert.equal(findLastFrontendSuspendToolIndex(parts), 1);
    assert.equal(findFinalProseIndex(parts), 3);
    assert.equal(isFinalProsePart(parts, 0), false);
    assert.equal(isFinalProsePart(parts, 3), true);
    assert.equal(hasPreFinalWork(parts), true);
  });

  it('without ask keeps only the last substantial text as final prose', () => {
    const parts = [
      { type: 'text', text: 'mid' },
      { type: 'reasoning', text: 't' },
      { type: 'text', text: 'final' },
    ];
    assert.equal(findFinalProseIndex(parts), 2);
    assert.equal(isFinalProsePart(parts, 0), false);
    assert.equal(isFinalProsePart(parts, 2), true);
  });

  it('ask without follow-up prose has no final prose index', () => {
    const parts = [
      { type: 'text', text: 'pre' },
      { type: 'tool-ask_user_question' },
    ];
    assert.equal(findFinalProseIndex(parts), -1);
    assert.equal(hasPreFinalWork(parts), true);
  });
});

describe('frontend-suspend settle', () => {
  it('is unsettled while awaiting ask answer', () => {
    const parts = [
      {
        type: 'tool-ask_user_question',
        state: 'input-available',
      },
    ];
    assert.equal(isFrontendSuspendPartsSettled(parts), false);
  });

  it('is unsettled after answers until follow-up text exists', () => {
    const parts = [
      {
        type: 'tool-ask_user_question',
        state: 'output-available',
        output: { answers: { 优化范围: '某台瓶颈设备' }, questions: [] },
      },
    ];
    assert.equal(isFrontendSuspendPartsSettled(parts), false);
    const messages = [
      { id: 'a', role: 'assistant', parts },
    ] as UIMessage[];
    assert.equal(needsFrontendSuspendContinuation(messages), true);
    assert.equal(isFrontendSuspendTurnSettled(messages), false);
  });

  it('is settled once follow-up text exists after ask', () => {
    const parts = [
      {
        type: 'tool-ask_user_question',
        state: 'output-available',
        output: { answers: { 优化范围: '某台瓶颈设备' }, questions: [] },
      },
      { type: 'step-start' },
      { type: 'text', text: '最终方案' },
    ];
    assert.equal(isFrontendSuspendPartsSettled(parts), true);
    const messages = [
      { id: 'a', role: 'assistant', parts },
    ] as UIMessage[];
    assert.equal(needsFrontendSuspendContinuation(messages), false);
    assert.equal(isFrontendSuspendTurnSettled(messages), true);
  });

  it('hasPreFinalWork is true during multi-step ask turns (enables progressive fold)', () => {
    const parts = [
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: '让我进一步查看关键维度的分布情况。' },
      { type: 'tool-table_get' },
      {
        type: 'tool-ask_user_question',
        state: 'input-available',
      },
    ];
    assert.equal(hasPreFinalWork(parts, findFinalProseIndex(parts)), true);
    assert.equal(isFrontendSuspendPartsSettled(parts), false);
  });
});
