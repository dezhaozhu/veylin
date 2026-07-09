import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatTaskNotification } from './task-notification.js';
import {
  INTERRUPTED_TURN_NOTE,
  isInterruptedAssistantMessage,
  stripInterruptedAssistantTurnsForAgent,
} from './interrupted-turn.js';

describe('interrupted-turn', () => {
  it('detects interrupted metadata', () => {
    assert.equal(
      isInterruptedAssistantMessage({
        role: 'assistant',
        metadata: { custom: { interrupted: true } },
      }),
      true,
    );
    assert.equal(
      isInterruptedAssistantMessage({
        role: 'assistant',
        metadata: { custom: { sentAt: 1 } },
      }),
      false,
    );
  });

  it('keeps interrupted assistant until a real user follow-up exists', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: '我先读取表格…' }],
        metadata: { custom: { interrupted: true } },
      },
    ];
    const stripped = stripInterruptedAssistantTurnsForAgent(messages);
    assert.equal((stripped[0]!.parts![0] as { text: string }).text, '我先读取表格…');
  });

  it('replaces interrupted narrative after a real user follow-up', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: '我先读取表格中的全部数据，然后派发一个子智能体。' },
          { type: 'reasoning', text: '思考中' },
        ],
        metadata: { custom: { interrupted: true, sentAt: 1 } },
      },
      {
        id: 'u2',
        role: 'user',
        parts: [{ type: 'text', text: '你好' }],
      },
    ];
    const stripped = stripInterruptedAssistantTurnsForAgent(messages);
    assert.equal(stripped.length, 2);
    assert.deepEqual(stripped[0]!.parts, [{ type: 'text', text: INTERRUPTED_TURN_NOTE }]);
    assert.equal(
      (stripped[0] as { content?: string }).content,
      INTERRUPTED_TURN_NOTE,
    );
    assert.equal((stripped[1]!.parts![0] as { text: string }).text, '你好');
  });

  it('does not treat task-notification users as follow-up for stripping', () => {
    const notification = formatTaskNotification({
      taskId: 'bg-1',
      status: 'completed',
      summary: 'done',
    });
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: '派发中…' }],
        metadata: { custom: { interrupted: true } },
      },
      {
        id: 'n1',
        role: 'user',
        parts: [{ type: 'text', text: notification }],
      },
    ];
    const stripped = stripInterruptedAssistantTurnsForAgent(messages);
    assert.equal((stripped[0]!.parts![0] as { text: string }).text, '派发中…');
  });

  it('leaves non-interrupted assistants unchanged', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: '正常回复' }],
      },
      {
        id: 'u2',
        role: 'user',
        parts: [{ type: 'text', text: '继续' }],
      },
    ];
    const stripped = stripInterruptedAssistantTurnsForAgent(messages);
    assert.equal((stripped[0]!.parts![0] as { text: string }).text, '正常回复');
  });
});
