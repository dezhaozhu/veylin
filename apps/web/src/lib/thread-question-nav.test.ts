import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ThreadMessage } from '@assistant-ui/react';
import { formatTaskNotification } from '@veylin/shared';
import {
  collectThreadQuestions,
  truncateQuestionLabel,
} from './thread-question-nav';

describe('thread-question-nav', () => {
  it('collects visible user questions and skips notifications', () => {
    const notification = formatTaskNotification({
      taskId: 't1',
      status: 'completed',
      summary: 'done',
    });

    const items = collectThreadQuestions([
      {
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: '什么是 Planner?' }],
        createdAt: new Date(),
      },
      {
        id: 'u2',
        role: 'user',
        content: [{ type: 'text', text: notification }],
        createdAt: new Date(),
      },
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'answer' }],
        createdAt: new Date(),
      },
      {
        id: 'u3',
        role: 'user',
        content: [{ type: 'text', text: '继续' }],
        createdAt: new Date(),
      },
    ] as ThreadMessage[]);

    assert.deepEqual(items, [
      { id: 'u1', label: '什么是 Planner?' },
      { id: 'u3', label: '继续' },
    ]);
  });

  it('uses the typed question, not the quoted prefix, as the rail label', () => {
    const items = collectThreadQuestions([
      {
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: '> 甘特图 (get_gantt)\n\n这是什么' }],
        createdAt: new Date(),
      },
      {
        id: 'u2',
        role: 'user',
        content: [{ type: 'text', text: '下一步' }],
        createdAt: new Date(),
      },
    ] as ThreadMessage[]);

    assert.equal(items[0]?.label, '这是什么');
  });

  it('truncates long labels', () => {
    const label = truncateQuestionLabel('a'.repeat(60), 20);
    assert.equal(label.endsWith('…'), true);
    assert.equal(label.length, 20);
  });
});
