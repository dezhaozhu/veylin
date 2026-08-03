import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { __test__ } from './rag-repos.js';

describe('rag search fusion', () => {
  it('merges ranked lists with reciprocal rank fusion', () => {
    const merged = __test__.reciprocalRankFusion([
      [
        {
          chunkId: 'a',
          documentId: 'd1',
          source: 'a.txt',
          text: 'a',
          offset: 0,
        },
        {
          chunkId: 'b',
          documentId: 'd1',
          source: 'a.txt',
          text: 'b',
          offset: 10,
        },
      ],
      [
        {
          chunkId: 'b',
          documentId: 'd1',
          source: 'a.txt',
          text: 'b',
          offset: 10,
        },
        {
          chunkId: 'c',
          documentId: 'd1',
          source: 'a.txt',
          text: 'c',
          offset: 20,
        },
      ],
    ]);
    assert.equal(merged[0]?.chunkId, 'b');
    assert.ok(merged.length >= 2);
  });

  it('assigns stable ref indexes', () => {
    const refs = __test__.withRefIndexes([
      {
        chunkId: 'a',
        documentId: 'd1',
        source: 'a.txt',
        text: 'a',
        offset: 0,
        score: 1,
      },
    ]);
    assert.deepEqual(refs.map((r) => r.refIndex), [1]);
  });
});
