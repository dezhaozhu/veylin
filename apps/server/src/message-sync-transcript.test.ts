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

  it('preserves interrupted metadata through mastra round-trip', () => {
    const identity = { threadId: 't1', tenantId: 'tenant', resourceId: 'user' };
    const source = [
      {
        id: 'a1',
        role: 'assistant',
        metadata: { custom: { sentAt: 42, interrupted: true } },
        parts: [{ type: 'text', text: '说到一半…' }],
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
    const custom = (ui[0]?.metadata as { custom?: { sentAt?: number; interrupted?: boolean } })
      ?.custom;
    assert.equal(custom?.sentAt, 42);
    assert.equal(custom?.interrupted, true);
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

  it('dedupes repeated assistant narration on persist and recall', () => {
    const identity = { threadId: 't1', tenantId: 'tenant', resourceId: 'user' };
    const intro = '好的！我来帮你创建一个写故事的 skill。';
    const source = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: intro },
          { type: 'text', text: '先聊聊你的想法。' },
          {
            type: 'tool-ask_user_question',
            state: 'output-available',
            output: { answers: { Q: 'A' } },
          },
          { type: 'step-start' },
          { type: 'reasoning', text: intro },
          { type: 'text', text: '先聊聊你的想法。' },
          { type: 'text', text: '好的，清楚了！' },
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

    const reasoning = ui[0]?.parts?.filter((p) => (p as { type?: string }).type === 'reasoning') ?? [];
    assert.equal(reasoning.length, 1);
    assert.equal((reasoning[0] as { text?: string }).text, intro);
    assert.ok(ui[0]?.parts?.some((p) => (p as { text?: string }).text === '好的，清楚了！'));
  });
});
