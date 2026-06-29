import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { embedTranscriptEnvelope, extractTranscriptEnvelope } from '@veylin/shared';
import { mastraMessagesToUi, uiMessagesToMastra } from './message-sync.js';

describe('message-sync transcript round-trip', () => {
  it('preserves reasoning, tools, step boundaries, and sentAt', () => {
    const identity = { threadId: 't1', tenantId: 'tenant', resourceId: 'user' };
    const source = [
      {
        id: 'a1',
        role: 'assistant',
        metadata: { custom: { sentAt: 1_700_000_000_000 } },
        parts: [
          { type: 'reasoning', text: '可以的，我能通过 task 工具调度多个子智能体。' },
          { type: 'step-start' },
          {
            type: 'tool-task',
            toolCallId: 'tc1',
            state: 'output-available',
            input: { prompt: 'demo' },
            output: { ok: true },
          },
          { type: 'text', text: '| 类型 | 用途 |\n| --- | --- |' },
        ],
      },
    ];

    const mastra = uiMessagesToMastra(source, identity);
    const ui = mastraMessagesToUi(
      mastra.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      })),
    );

    assert.equal(ui.length, 1);
    assert.equal((ui[0]?.metadata as { custom?: { sentAt?: number } })?.custom?.sentAt, 1_700_000_000_000);
    const types = ui[0]?.parts?.map((p) => (p as { type?: string }).type);
    assert.ok(types?.includes('reasoning'));
    assert.ok(types?.includes('step-start'));
    assert.ok(types?.some((t) => t?.startsWith('tool-')));
    assert.ok(types?.includes('text'));
  });

  it('extractTranscriptEnvelope matches embed output from mastra parts', () => {
    const parts = embedTranscriptEnvelope(
      [{ type: 'text', text: 'hello' }],
      { custom: { sentAt: 42 } },
    );
    const restored = extractTranscriptEnvelope(parts);
    assert.equal(restored.meta?.sentAt, 42);
    assert.deepEqual(restored.parts, [{ type: 'text', text: 'hello' }]);
  });
});
