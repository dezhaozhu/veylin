import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { __test__ } from './rag-entities.js';

describe('rag entity graph extraction', () => {
  it('samples large chunk lists down to a bounded size', () => {
    const chunks = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, text: `chunk ${i}` }));
    const sampled = __test__.sampleChunksForGraph(chunks);
    assert.ok(sampled.length <= 24);
    assert.ok(sampled.length > 0);
  });
});
