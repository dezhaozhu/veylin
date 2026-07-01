import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMPACTION_SYSTEM_PROMPT, formatCompactSummary } from './summarizer.js';

describe('summarizer', () => {
  it('defines structured compaction sections', () => {
    assert.match(COMPACTION_SYSTEM_PROMPT, /All user messages/);
    assert.match(COMPACTION_SYSTEM_PROMPT, /<analysis>/);
  });

  it('strips analysis draft before storing summary', () => {
    const raw = [
      '<analysis>scratch notes</analysis>',
      '## Primary request & intent',
      'User asked for a report.',
    ].join('\n');

    const cleaned = formatCompactSummary(raw);
    assert.doesNotMatch(cleaned, /scratch notes/);
    assert.match(cleaned, /Primary request/);
  });
});
