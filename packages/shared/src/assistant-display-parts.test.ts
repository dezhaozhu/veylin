import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dedupeAssistantMessageParts,
  migrateLegacyToolPart,
  normalizeAssistantMessageParts,
} from './assistant-display-parts.js';

describe('migrateLegacyToolPart', () => {
  it('converts tool-invocation into tool-{name} for UI', () => {
    const migrated = migrateLegacyToolPart({
      type: 'tool-invocation',
      toolInvocation: {
        state: 'result',
        toolCallId: 'call_1',
        toolName: 'task',
        args: { description: '工厂维度分析' },
        result: { task_id: 'abc', background: true },
      },
    }) as { type?: string; state?: string; output?: { task_id?: string } };

    assert.equal(migrated.type, 'tool-task');
    assert.equal(migrated.state, 'output-available');
    assert.equal(migrated.output?.task_id, 'abc');
  });
});

describe('normalizeAssistantMessageParts', () => {
  it('removes repeated narration after an answered ask_user_question step', () => {
    const intro = '好的！我来帮你创建一个写故事的 skill。在动手之前，让我先了解一下你的具体需求。';
    const questions = '先聊聊你的想法。我有一些问题需要确认：';
    const tool = {
      type: 'tool-ask_user_question',
      state: 'output-available',
      output: { answers: { Q: 'A' } },
    };

    const parts = normalizeAssistantMessageParts([
      { type: 'reasoning', text: intro },
      { type: 'text', text: questions },
      tool,
      { type: 'step-start' },
      { type: 'reasoning', text: intro },
      { type: 'text', text: questions },
      {
        type: 'tool-ask_user_question',
        state: 'output-available',
        output: { answers: { Q2: 'B' } },
      },
      { type: 'step-start' },
      { type: 'reasoning', text: '好的，清楚了！你想创作中文长篇小说。' },
    ]);

    assert.equal(parts.filter((p) => (p as { type?: string }).type === 'reasoning').length, 2);
    assert.equal(
      parts.filter((p) => (p as { type?: string }).type === 'tool-ask_user_question').length,
      2,
    );
  });

  it('drops empty reasoning shells and keeps following text', () => {
    const parts = normalizeAssistantMessageParts([
      { type: 'reasoning', text: '' },
      { type: 'text', text: '4个分析Agent已全部并行派发完成' },
      { type: 'step-start' },
      { type: 'reasoning', text: '' },
      { type: 'text', text: '请稍候，各Agent正在工作中' },
    ]);

    assert.deepEqual(
      parts.map((p) => (p as { type?: string }).type),
      ['text', 'step-start', 'text'],
    );
  });

  it('drops empty text shells that would split adjacent reasoning groups', () => {
    const parts = normalizeAssistantMessageParts([
      { type: 'reasoning', text: '先想一步' },
      { type: 'text', text: '' },
      { type: 'reasoning', text: '再想一步' },
    ]);

    assert.deepEqual(
      parts.map((p) => ({
        type: (p as { type?: string }).type,
        text: (p as { text?: string }).text,
      })),
      [
        { type: 'reasoning', text: '先想一步' },
        { type: 'reasoning', text: '再想一步' },
      ],
    );
  });

  it('merges narration-only step boundaries in display mode', () => {
    const parts = normalizeAssistantMessageParts(
      [
        { type: 'text', text: '派发完成表格' },
        { type: 'step-start' },
        { type: 'text', text: '请稍候' },
      ],
      { mode: 'display' },
    );

    assert.equal(parts.length, 1);
    assert.match((parts[0] as { text?: string }).text ?? '', /派发完成表格/);
    assert.match((parts[0] as { text?: string }).text ?? '', /请稍候/);
  });

  it('migrates legacy tools and preserves them in the transcript', () => {
    const parts = normalizeAssistantMessageParts([
      { type: 'text', text: '开始' },
      {
        type: 'tool-invocation',
        toolInvocation: {
          state: 'result',
          toolCallId: 'c1',
          toolName: 'table_get',
          args: {},
          result: { rows: [] },
        },
      },
    ]);

    assert.equal((parts[1] as { type?: string }).type, 'tool-table_get');
  });

  it('is idempotent when step-start markers are already present', () => {
    const parts = [
      { type: 'reasoning', text: '第一段' },
      { type: 'step-start' },
      { type: 'reasoning', text: '第二段' },
      { type: 'step-start' },
      { type: 'text', text: '收尾' },
    ];

    const once = normalizeAssistantMessageParts(parts);
    const twice = normalizeAssistantMessageParts(once);
    assert.equal(twice, once);
  });

  it('starts a new logical step after a completed suspend tool without step-start', () => {
    const intro = '第一段说明';
    const parts = dedupeAssistantMessageParts([
      { type: 'reasoning', text: intro },
      {
        type: 'tool-ask_user_question',
        state: 'output-available',
        output: { answers: { Q: 'A' } },
      },
      { type: 'reasoning', text: intro },
      { type: 'text', text: '第二段新问题' },
    ]);

    assert.deepEqual(
      parts.map((p) => (p as { type?: string }).type),
      ['reasoning', 'tool-ask_user_question', 'step-start', 'text'],
    );
  });
});
