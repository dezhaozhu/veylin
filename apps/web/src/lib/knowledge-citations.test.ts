import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractKnowledgeCitations } from './knowledge-citations';

describe('extractKnowledgeCitations', () => {
  it('extracts from tool-knowledge_search output', () => {
    const parts = [
      {
        type: 'tool-knowledge_search',
        state: 'output-available',
        output: {
          references: [
            {
              chunkId: 'c1',
              documentId: 'd1',
              source: 'manual.md',
              text: 'snippet one',
              offset: 0,
              score: 1.5,
            },
            {
              chunkId: 'c2',
              documentId: 'd1',
              source: 'manual.md',
              text: 'snippet two',
              offset: 100,
              score: 0.5,
            },
          ],
        },
      },
    ];

    const refs = extractKnowledgeCitations(parts);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]?.source, 'manual.md');
    assert.equal(refs[0]?.chunkId, 'c1');
    assert.equal(refs[0]?.score, 1.5);
  });

  it('ignores incomplete tool parts', () => {
    const parts = [
      {
        type: 'tool-knowledge_search',
        state: 'input-available',
        output: {
          references: [
            {
              chunkId: 'c1',
              documentId: 'd1',
              source: 'manual.md',
              text: 'snippet',
              offset: 0,
            },
          ],
        },
      },
    ];
    assert.equal(extractKnowledgeCitations(parts).length, 0);
  });

  it('merges multiple knowledge_search calls', () => {
    const parts = [
      {
        type: 'tool-knowledge_search',
        state: 'output-available',
        output: {
          references: [
            {
              chunkId: 'c1',
              documentId: 'd1',
              source: 'a.txt',
              text: 'a',
              offset: 0,
            },
          ],
        },
      },
      {
        type: 'tool-knowledge_search',
        state: 'output-available',
        output: {
          references: [
            {
              chunkId: 'c2',
              documentId: 'd2',
              source: 'b.txt',
              text: 'b',
              offset: 0,
            },
          ],
        },
      },
    ];
    const refs = extractKnowledgeCitations(parts);
    assert.equal(refs.length, 2);
    assert.deepEqual(
      refs.map((r) => r.source).sort(),
      ['a.txt', 'b.txt'],
    );
  });
});
