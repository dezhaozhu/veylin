import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findFinalProseIndex,
  findLastSubstantialTextIndex,
  hasPreFinalWork,
  isFinalProsePart,
  isSubstantialTextPart,
} from './assistant-final-output.js';

describe('assistant-final-output', () => {
  it('detects substantial text parts', () => {
    assert.equal(isSubstantialTextPart({ type: 'text', text: '  hi  ' }), true);
    assert.equal(isSubstantialTextPart({ type: 'text', text: '   ' }), false);
    assert.equal(isSubstantialTextPart({ type: 'reasoning', text: 'x' }), false);
  });

  it('uses the last substantial text as finished output', () => {
    const parts = [
      { type: 'text', text: '过程提示' },
      { type: 'tool-ask_user_question' },
      { type: 'step-start' },
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: '最终方案' },
      { type: 'text', text: '  ' },
    ];
    assert.equal(findLastSubstantialTextIndex(parts), 4);
    assert.equal(findFinalProseIndex(parts), 4);
    assert.equal(isFinalProsePart(parts, 0), false);
    assert.equal(isFinalProsePart(parts, 4), true);
    assert.equal(hasPreFinalWork(parts), true);
  });

  it('does not infer lifecycle from an ask marker', () => {
    const parts = [
      { type: 'text', text: '等待回答前的提示' },
      { type: 'tool-ask_user_question' },
    ];
    assert.equal(findFinalProseIndex(parts), 0);
    assert.equal(hasPreFinalWork(parts), true);
  });

  it('reports no pre-final work for prose-only output', () => {
    assert.equal(hasPreFinalWork([{ type: 'text', text: 'only' }]), false);
    assert.equal(findFinalProseIndex([{ type: 'tool-call' }]), -1);
  });
});
