import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { __test__ } from './rag-reranker.js';

describe('rag reranker', () => {
  it('converts binary logits to relevance probability', () => {
    const score = __test__.scoreFromLogits([1, 3]);
    assert.ok(score > 0.8);
  });
});
