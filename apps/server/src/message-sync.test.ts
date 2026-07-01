import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatTaskNotification, isTaskNotificationText } from '@veylin/shared';
import {
  countTaskNotificationsForTaskIds,
  evaluateBackgroundBatchReadiness,
  mastraMessagesToAgentContext,
  mastraMessagesToUi,
  mergeAgentContextMessages,
  normalizeRecalledUiMessages,
  resolveSnapshotBatchRows,
} from './message-sync.js';

describe('message-sync recall normalization', () => {
  it('drops model-only continuation user messages', () => {
    const normalized = normalizeRecalledUiMessages([
      {
        role: 'user',
        parts: [{ type: 'text', text: '请用 ask_user_question 问我一个单选题' }],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-ask_user_question',
            state: 'output-available',
            output: { answers: { Q: 'A' } },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'User has answered your questions: "Q"="A". You can now continue with the user\'s answers in mind.',
          },
        ],
      },
      {
        role: 'assistant',
        parts: [{ type: 'text', text: '回答正确！' }],
      },
    ]);

    assert.equal(normalized.length, 3);
    assert.equal(normalized[0]?.role, 'user');
    assert.equal(normalized[1]?.role, 'assistant');
    assert.equal(normalized[2]?.role, 'assistant');
  });

  it('dedupes repeated user turns after assistant content', () => {
    const normalized = normalizeRecalledUiMessages([
      {
        role: 'user',
        id: 'u1',
        parts: [{ type: 'text', text: '请用 ask_user_question 问我一个单选题' }],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-ask_user_question',
            state: 'output-available',
            output: { answers: { Q: 'Python' } },
          },
        ],
      },
      {
        role: 'user',
        id: 'u2',
        parts: [{ type: 'text', text: '请用 ask_user_question 问我一个单选题' }],
      },
      {
        role: 'assistant',
        parts: [{ type: 'text', text: '回答正确！' }],
      },
    ]);

    assert.equal(normalized.length, 3);
    assert.equal(normalized.filter((m) => m.role === 'user').length, 1);
  });

  it('drops task-notification user messages from display recall', () => {
    const notification = `<task-notification>
<task-id>t1</task-id>
<status>completed</status>
<summary>Agent done</summary>
</task-notification>`;
    const normalized = normalizeRecalledUiMessages(
      [
        { role: 'user', parts: [{ type: 'text', text: '分析一下数据' }] },
        { role: 'assistant', parts: [{ type: 'text', text: '请稍候' }] },
        { role: 'user', parts: [{ type: 'text', text: notification }] },
      ],
      { forDisplay: true },
    );

    assert.equal(normalized.length, 2);
    assert.equal(JSON.stringify(normalized).includes('task-notification'), false);
  });

  it('mastraMessagesToUi applies normalization', () => {
    const ui = mastraMessagesToUi([
      {
        role: 'user',
        content: {
          parts: [{ type: 'text', text: 'hello' }],
        },
      },
      {
        role: 'user',
        content: {
          parts: [{ type: 'text', text: 'hello' }],
        },
      },
    ]);

    assert.equal(ui.length, 1);
    assert.equal(ui[0]?.role, 'user');
  });

  it('mastraMessagesToAgentContext keeps task notifications for readiness', () => {
    const notification = formatTaskNotification({
      taskId: 't1',
      status: 'completed',
      summary: 'Agent "A" completed',
      result: 'done',
    });
    const agentContext = mastraMessagesToAgentContext([
      {
        role: 'user',
        content: { parts: [{ type: 'text', text: notification }] },
      },
    ]);
    assert.equal(agentContext.length, 1);
    const readiness = evaluateBackgroundBatchReadiness(
      [{ id: 't1', status: 'done' }],
      agentContext,
    );
    assert.equal(readiness.notificationsReady, true);
    assert.equal(readiness.synthesisReady, true);
  });

  it('counts task notifications for a worker batch', () => {
    const notification = formatTaskNotification({
      taskId: 't1',
      status: 'completed',
      summary: 'Agent "A" completed',
    });
    const count = countTaskNotificationsForTaskIds(
      [
        { role: 'user', parts: [{ type: 'text', text: notification }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'dispatch' }] },
      ],
      ['t1', 't2'],
    );
    assert.equal(count, 1);

    const readiness = evaluateBackgroundBatchReadiness(
      [
        { id: 't1', status: 'done' },
        { id: 't2', status: 'done' },
      ],
      [
        { role: 'user', parts: [{ type: 'text', text: notification }] },
      ],
    );
    assert.equal(readiness.notificationsReady, false);
    assert.equal(readiness.synthesisReady, false);
  });

  it('resolveSnapshotBatchRows prefers explicit ids, else active tasks only', () => {
    const rows = [
      { id: 'old', status: 'done' },
      { id: 'run', status: 'running' },
      { id: 'q', status: 'queued' },
    ];
    assert.deepEqual(resolveSnapshotBatchRows(rows, ['old']), [{ id: 'old', status: 'done' }]);
    assert.deepEqual(resolveSnapshotBatchRows(rows, []), [
      { id: 'run', status: 'running' },
      { id: 'q', status: 'queued' },
    ]);
  });

  it('mergeAgentContextMessages uses server notifications only (one per task)', () => {
    const resultBody = 'FULL WORKER REPORT';
    const serverNote = formatTaskNotification({
      taskId: 't1',
      status: 'completed',
      summary: 'Agent "A" completed',
      result: resultBody,
    });
    const clientNote = formatTaskNotification({
      taskId: 't1',
      status: 'completed',
      summary: 'Agent "A" completed',
      result: resultBody,
    });
    const merged = mergeAgentContextMessages(
      [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'analyze' }] },
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'dispatching' }] },
        { id: 'task-notif-t1', role: 'user', parts: [{ type: 'text', text: clientNote }] },
      ],
      [
        { id: 'legacy-uuid', role: 'user', parts: [{ type: 'text', text: serverNote }] },
        {
          id: 'legacy-uuid-dup',
          role: 'user',
          parts: [{ type: 'text', text: serverNote }],
        },
      ],
    );
    const textPart = (parts: unknown[] | undefined): string => {
      const part = parts?.find(
        (p): p is { type: string; text: string } =>
          typeof p === 'object' &&
          p != null &&
          (p as { type?: string }).type === 'text' &&
          typeof (p as { text?: unknown }).text === 'string',
      );
      return part?.text ?? '';
    };
    const notifications = merged.filter((m) => {
      const text = textPart(m.parts);
      return m.role === 'user' && isTaskNotificationText(text);
    });
    assert.equal(notifications.length, 1);
    assert.equal(merged.length, 3);
    assert.equal(merged[2]?.role, 'user');
    const noteText = textPart(notifications[0]?.parts);
    assert.match(noteText, /FULL WORKER REPORT/);
  });
});
