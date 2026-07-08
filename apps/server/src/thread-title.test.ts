import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstUserText, truncateTitle } from './thread-title.js';

describe('thread-title', () => {
  it('reads first user text from legacy content string', () => {
    assert.equal(
      firstUserText([{ role: 'user', content: '  排产瓶颈有哪些？  ' }]),
      '排产瓶颈有哪些？',
    );
  });

  it('reads first user text from parts array', () => {
    assert.equal(
      firstUserText([
        { role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
        { role: 'user', parts: [{ type: 'text', text: '继续分析' }] },
      ]),
      '继续分析',
    );
  });

  it('truncates long titles', () => {
    const title = truncateTitle('a'.repeat(80), 20);
    assert.equal(title.length, 20);
    assert.equal(title.endsWith('...'), true);
  });
});
