import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findLastSubstantialTextIndex,
  hasPreFinalWork,
  isSubstantialTextPart,
} from './assistant-final-output.js';

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
});
