import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  citationSnippetPreview,
  extractKnowledgeCitations,
  filterCitationsUsedInAnswer,
} from './knowledge-citations';

describe('extractKnowledgeCitations', () => {
  it('extracts from tool-knowledge_search output with refIndex', () => {
    const parts = [
      {
        type: 'tool-knowledge_search',
        state: 'output-available',
        output: {
          references: [
            {
              refIndex: 1,
              chunkId: 'c1',
              documentId: 'd1',
              source: 'manual.md',
              text: 'snippet one',
              offset: 0,
              score: 1.5,
            },
            {
              refIndex: 2,
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
    assert.equal(refs.length, 2);
    assert.deepEqual(
      refs.map((r) => r.refIndex),
      [1, 2],
    );
  });

  it('filters citations to those referenced in the answer text', () => {
    const citations = [
      {
        refIndex: 1,
        chunkId: 'c1',
        documentId: 'd1',
        source: 'a.txt',
        text: 'a',
        offset: 0,
      },
      {
        refIndex: 2,
        chunkId: 'c2',
        documentId: 'd2',
        source: 'b.txt',
        text: 'b',
        offset: 0,
      },
    ];
    const filtered = filterCitationsUsedInAnswer(
      citations,
      'The policy is described in [1] and summarized here.',
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.refIndex, 1);
  });
});

describe('citationSnippetPreview', () => {
  it('collapses whitespace and truncates long text', () => {
    const preview = citationSnippetPreview('line one\n\nline two '.repeat(10), 40);
    assert.ok(preview.endsWith('…'));
    assert.ok(!preview.includes('\n'));
  });
});
