import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  embedTranscriptEnvelope,
  extractTranscriptEnvelope,
  STEP_BOUNDARY_PART_TYPE,
  TRANSCRIPT_META_PART_TYPE,
} from './transcript-persist.js';
import { filterPersistableUiMessageParts } from './ui-message-parts.js';

describe('transcript-persist', () => {
  it('round-trips sentAt metadata and step boundaries', () => {
    const parts = embedTranscriptEnvelope(
      [
        { type: 'reasoning', text: 'thinking' },
        { type: 'step-start' },
        { type: 'text', text: 'answer' },
      ],
      { custom: { sentAt: 1_700_000_000_000 } },
    );

    assert.ok(parts.some((p) => (p as { type?: string }).type === STEP_BOUNDARY_PART_TYPE));
    assert.ok(parts.some((p) => (p as { type?: string }).type === TRANSCRIPT_META_PART_TYPE));

    const restored = extractTranscriptEnvelope(parts);
    assert.equal(restored.meta?.sentAt, 1_700_000_000_000);
    assert.deepEqual(
      restored.parts.map((p) => (p as { type?: string }).type),
      ['reasoning', 'step-start', 'text'],
    );
  });

  it('round-trips interrupted flag in transcript meta', () => {
    const parts = embedTranscriptEnvelope(
      [{ type: 'text', text: 'partial reply' }],
      { custom: { sentAt: 99, interrupted: true } },
    );
    const restored = extractTranscriptEnvelope(parts);
    assert.equal(restored.meta?.sentAt, 99);
    assert.equal(restored.meta?.interrupted, true);
  });
});

describe('filterPersistableUiMessageParts', () => {
  it('keeps step-start and veylin data parts', () => {
    const parts = filterPersistableUiMessageParts([
      { type: 'step-start' },
      { type: 'data-veylin-transcript-meta', data: { sentAt: 1 } },
      { type: 'reasoning', text: 'thought' },
      { type: 'tool-task', state: 'output-available', output: {} },
    ]);
    assert.equal(parts.length, 4);
  });

  it('adds reasoning.details for Mastra memory persistence', () => {
    const [reasoning] = filterPersistableUiMessageParts([
      { type: 'reasoning', text: 'chain of thought' },
    ]);
    assert.equal((reasoning as { type?: string }).type, 'reasoning');
    assert.deepEqual((reasoning as { details?: unknown[] }).details, [
      { type: 'text', text: 'chain of thought' },
    ]);
  });
});
