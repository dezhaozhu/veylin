import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UIMessage } from 'ai';
import { formatTaskNotification } from '@veylin/shared';
import {
  appendTaskNotificationMessagesForSynthesis,
  assistantDispatchedBackgroundWorkers,
  backgroundTaskBatchFingerprint,
  buildInterruptedBackgroundTaskRows,
  collectCoordinatorDispatchTaskIds,
  collectLatestBackgroundTaskIds,
  collectOptimisticBackgroundTasksFromThreadMessages,
  collectSubagentTasksFromThreadMessages,
  coordinatorTurnHasBackgroundDispatch,
  filterTasksToCurrentBatch,
  hasActiveBackgroundTasks,
  isCoordinatorTurnUnsettled,
  isCoordinatorPartialTurn,
  applyInterruptedTaskIds,
  markActiveBackgroundTasksCancelled,
  mergePanelBackgroundTasks,
  mergePanelBackgroundTasksFromThread,
  overlayBackgroundTaskStatus,
  resolvePanelBackgroundTasks,
  shouldSynthesizeBackgroundTaskResults,
  stripTaskNotificationUserMessages,
} from './background-task-continuation.js';

const awaitingAssistant = {
  id: 'a1',
  role: 'assistant',
  parts: [
    {
      type: 'text',
      text: '子智能体结果到达后我会立即整合汇报',
    },
    {
      type: 'tool-task',
      toolCallId: 't-dispatch',
      state: 'output-available',
      output: { background: true, task_id: 'bg-1' },
    },
  ],
} as UIMessage;

describe('background task continuation', () => {
  it('markActiveBackgroundTasksCancelled flips queued/running to cancelled', () => {
    const input = [
      { id: 'a', status: 'running' },
      { id: 'b', status: 'queued' },
      { id: 'c', status: 'done' },
      { id: 'd', status: 'failed' },
    ];
    const next = markActiveBackgroundTasksCancelled(input);
    assert.notEqual(next, input);
    assert.deepEqual(
      next.map((t) => t.status),
      ['cancelled', 'cancelled', 'done', 'failed'],
    );
    assert.equal(markActiveBackgroundTasksCancelled(next), next);
  });

  it('buildInterruptedBackgroundTaskRows seeds cancelled rows from optimistic dispatch', () => {
    const rows = buildInterruptedBackgroundTaskRows(
      [],
      [{ id: 'bg-1', status: 'running', label: '分析' }],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, 'bg-1');
    assert.equal(rows[0]?.status, 'cancelled');
  });

  it('overlayBackgroundTaskStatus prefers terminal store status', () => {
    const merged = overlayBackgroundTaskStatus(
      { id: 'bg-1', status: 'running', label: '分析' },
      { id: 'bg-1', status: 'cancelled' },
    );
    assert.equal(merged.status, 'cancelled');
    assert.equal(merged.label, '分析');
  });

  it('mergePanelBackgroundTasksFromThread keeps cancelled after stop', () => {
    const thread = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolName: 'task',
            toolCallId: 'tc1',
            args: { description: '分析' },
            result: { background: true, task_id: 'bg-1', description: '分析' },
          },
        ],
      },
    ] as never;
    const merged = mergePanelBackgroundTasksFromThread(
      thread,
      [{ id: 'bg-1', status: 'cancelled' }],
      { pinnedTaskIds: ['bg-1'] },
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.status, 'cancelled');
  });

  it('interrupt with empty store forces optimistic active rows to cancelled', () => {
    const thread = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolName: 'task',
            toolCallId: 'tc-opt',
            args: { description: '调研' },
            result: { background: true, task_id: 'bg-opt', description: '调研' },
          },
        ],
      },
    ] as never;
    const optimistic = collectSubagentTasksFromThreadMessages(thread);
    assert.ok(optimistic.length >= 1);
    assert.ok(optimistic[0]?.status === 'queued' || optimistic[0]?.status === 'running');

    const interrupted = buildInterruptedBackgroundTaskRows([], optimistic);
    assert.equal(interrupted[0]?.status, 'cancelled');

    const display = mergePanelBackgroundTasksFromThread(thread, [], {
      interruptedTaskIds: interrupted.map((row) => row.id),
    });
    assert.ok(display.length >= 1);
    assert.ok(display.every((row) => row.status === 'cancelled'));
    assert.equal(hasActiveBackgroundTasks(display), false);
  });

  it('merge keeps cancelled when optimistic toolCallId differs from store task_id', () => {
    const thread = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolName: 'task',
            toolCallId: 'tool-call-xyz',
            args: { description: '分析' },
            // No result yet — optimistic id is toolCallId while store uses real task_id
          },
        ],
      },
    ] as never;
    const optimistic = collectSubagentTasksFromThreadMessages(thread);
    assert.equal(optimistic[0]?.id, 'tool-call-xyz');
    assert.equal(optimistic[0]?.status, 'running');

    const storeCancelled = [{ id: 'real-task-id', status: 'cancelled', label: '分析' }];
    const merged = mergePanelBackgroundTasksFromThread(thread, storeCancelled, {
      pinnedTaskIds: ['real-task-id'],
      interruptedTaskIds: ['real-task-id', 'tool-call-xyz'],
    });

    assert.ok(merged.some((row) => row.id === 'real-task-id' && row.status === 'cancelled'));
    assert.ok(merged.every((row) => row.status === 'cancelled'));
    assert.equal(hasActiveBackgroundTasks(merged), false);
  });

  it('buildInterruptedBackgroundTaskRows keeps temporary task-call ids', () => {
    const rows = buildInterruptedBackgroundTaskRows(
      [],
      [{ id: 'task-call-0', status: 'running', label: '临时' }],
      ['dispatch-real'],
    );
    assert.ok(rows.some((row) => row.id === 'task-call-0' && row.status === 'cancelled'));
    assert.ok(rows.some((row) => row.id === 'dispatch-real' && row.status === 'cancelled'));
  });

  it('applyInterruptedTaskIds only flips matching in-flight rows', () => {
    const next = applyInterruptedTaskIds(
      [
        { id: 'a', status: 'running' },
        { id: 'b', status: 'running' },
        { id: 'c', status: 'done' },
      ],
      ['a', 'missing'],
    );
    assert.equal(next.find((row) => row.id === 'a')?.status, 'cancelled');
    assert.equal(next.find((row) => row.id === 'b')?.status, 'running');
    assert.equal(next.find((row) => row.id === 'c')?.status, 'done');
    assert.equal(next.some((row) => row.id === 'missing'), false);
  });

  it('waits while workers are still active', () => {
    assert.equal(
      shouldSynthesizeBackgroundTaskResults(
        [awaitingAssistant],
        [{ id: 'bg-1', status: 'running' }],
        { notificationsReady: true },
      ),
      false,
    );
    assert.equal(
      isCoordinatorTurnUnsettled([awaitingAssistant], [{ id: 'bg-1', status: 'running' }]),
      true,
    );
    assert.equal(
      isCoordinatorPartialTurn([awaitingAssistant], [{ id: 'bg-1', status: 'running' }]),
      true,
    );
  });

  it('requires notificationsReady before synthesis', () => {
    const batch = [{ id: 'bg-1', status: 'done' }];
    assert.equal(
      shouldSynthesizeBackgroundTaskResults([awaitingAssistant], batch, {
        notificationsReady: false,
      }),
      false,
    );
    assert.equal(
      shouldSynthesizeBackgroundTaskResults([awaitingAssistant], batch, {
        notificationsReady: true,
      }),
      true,
    );
  });

  it('synthesizes after client-injected task notifications follow dispatch', () => {
    const notification = formatTaskNotification({
      taskId: 'bg-1',
      status: 'completed',
      summary: 'Agent "A" completed',
    });
    const messages = [
      awaitingAssistant,
      { id: 'n1', role: 'user', parts: [{ type: 'text', text: notification }] },
    ] as UIMessage[];
    assert.equal(
      shouldSynthesizeBackgroundTaskResults(messages, [{ id: 'bg-1', status: 'done' }], {
        notificationsReady: true,
      }),
      true,
    );
  });

  it('appendTaskNotificationMessagesForSynthesis is a no-op (server owns worker results)', () => {
    const batch = [{ id: 'bg-1', status: 'done', result: 'analysis', label: 'A' }];
    const first = appendTaskNotificationMessagesForSynthesis([awaitingAssistant], batch);
    assert.equal(first.length, 1);
    assert.equal(first[0]?.role, 'assistant');
    const second = appendTaskNotificationMessagesForSynthesis(first, batch);
    assert.equal(second.length, 1);
  });

  it('stripTaskNotificationUserMessages removes synthesis-only user turns', () => {
    const notification = formatTaskNotification({
      taskId: 'bg-1',
      status: 'completed',
      summary: 'Agent "A" completed',
      result: 'analysis',
    });
    const withNotif = [
      awaitingAssistant,
      { id: 'n1', role: 'user', parts: [{ type: 'text', text: notification }] },
    ] as UIMessage[];
    assert.equal(withNotif.length, 2);
    const stripped = stripTaskNotificationUserMessages(withNotif);
    assert.equal(stripped.length, 1);
    assert.equal(stripped[0]?.role, 'assistant');
  });

  it('does not synthesize after parent already produced a final reply', () => {
    const messages = [
      {
        id: 'a2',
        role: 'assistant',
        parts: [{ type: 'text', text: '综合报告如下：各维度分析已完成。' }],
      },
    ] as UIMessage[];
    assert.equal(
      shouldSynthesizeBackgroundTaskResults(messages, [{ id: 'bg-1', status: 'done' }], {
        notificationsReady: true,
      }),
      false,
    );
    assert.equal(
      isCoordinatorTurnUnsettled(messages, [{ id: 'bg-1', status: 'done' }], {
        notificationsReady: true,
      }),
      false,
    );
    assert.equal(
      isCoordinatorPartialTurn(messages, [{ id: 'bg-1', status: 'done' }], {
        notificationsReady: true,
      }),
      false,
    );
  });

  it('isCoordinatorPartialTurn stays true until synthesis completes', () => {
    const batch = [{ id: 'bg-1', status: 'done' }];
    assert.equal(
      isCoordinatorPartialTurn([awaitingAssistant], batch, {
        notificationsReady: true,
        chatStatus: 'ready',
      }),
      true,
    );
    assert.equal(
      isCoordinatorPartialTurn([awaitingAssistant], batch, {
        notificationsReady: true,
        historyLoading: true,
      }),
      false,
    );
    const synthesis = {
      id: 'a2',
      role: 'assistant',
      parts: [{ type: 'text', text: '综合报告如下。' }],
    } as UIMessage;
    assert.equal(
      isCoordinatorPartialTurn([awaitingAssistant, synthesis], batch, {
        notificationsReady: true,
      }),
      false,
    );
    assert.equal(
      isCoordinatorPartialTurn([awaitingAssistant, synthesis], [], {
        notificationsReady: true,
      }),
      false,
    );
  });

  it('settles after synthesis even when notificationsReady is still false on restore', () => {
    const synthesis = {
      id: 'a2',
      role: 'assistant',
      parts: [{ type: 'text', text: '综合报告如下。' }],
    } as UIMessage;
    const messages = [awaitingAssistant, synthesis] as UIMessage[];
    const batch = [{ id: 'bg-1', status: 'done' }];
    assert.equal(
      isCoordinatorTurnUnsettled(messages, batch, {
        notificationsReady: false,
        pinnedTaskIds: ['bg-1'],
      }),
      false,
    );
    assert.equal(
      isCoordinatorPartialTurn(messages, batch, {
        notificationsReady: false,
        pinnedTaskIds: ['bg-1'],
        chatStatus: 'ready',
      }),
      false,
    );
  });

  it('filters background tasks to the latest dispatch batch only', () => {
    const messages = [
      awaitingAssistant,
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '再来一轮' }] },
      {
        id: 'a2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-task',
            toolCallId: 'new',
            state: 'output-available',
            output: { background: true, task_id: 'new-1' },
          },
        ],
      },
    ] as UIMessage[];
    assert.deepEqual(collectCoordinatorDispatchTaskIds(messages), ['new-1']);
    assert.deepEqual(collectLatestBackgroundTaskIds(messages), ['new-1']);
    const allTasks = [
      { id: 'old-1', status: 'done' },
      { id: 'old-2', status: 'done' },
      { id: 'new-1', status: 'running' },
    ];
    const batch = filterTasksToCurrentBatch(messages, allTasks);
    assert.equal(batch.length, 1);
    assert.equal(batch[0]?.id, 'new-1');
  });

  it('ignores prior dispatch batches when the latest assistant turn has no task ids yet', () => {
    const messages = [
      awaitingAssistant,
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '再来一轮' }] },
      {
        id: 'a2',
        role: 'assistant',
        parts: [{ type: 'text', text: '正在派发子智能体…' }],
      },
    ] as UIMessage[];
    assert.deepEqual(collectCoordinatorDispatchTaskIds(messages), []);
    const tasks = [
      { id: 'bg-1', status: 'done' },
      { id: 'new-1', status: 'running' },
    ];
    const panel = resolvePanelBackgroundTasks(messages, tasks);
    assert.equal(panel.length, 1);
    assert.equal(panel[0]?.id, 'new-1');
  });

  it('reads background task ids from canonical output-shaped tool parts', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-task',
            toolCallId: 't1',
            state: 'output-available',
            output: { background: true, task_id: 'bg-1' },
          },
          {
            type: 'tool-task',
            toolCallId: 't2',
            state: 'output-available',
            output: { background: true, task_id: 'bg-2' },
          },
        ],
      },
    ] as UIMessage[];
    assert.deepEqual(collectCoordinatorDispatchTaskIds(messages), ['bg-1', 'bg-2']);
    const panel = resolvePanelBackgroundTasks(messages, [
      { id: 'bg-1', status: 'done' },
      { id: 'bg-2', status: 'running' },
    ]);
    assert.equal(panel.length, 2);
  });

  it('keeps terminal batch tasks visible for the panel via pinned ids', () => {
    const messages = [
      {
        id: 'a2',
        role: 'assistant',
        parts: [{ type: 'text', text: '正在汇总各智能体结果…' }],
      },
    ] as UIMessage[];
    const tasks = [
      { id: 'bg-1', status: 'done' },
      { id: 'bg-2', status: 'done' },
    ];
    const panel = resolvePanelBackgroundTasks(messages, tasks, {
      pinnedTaskIds: ['bg-1', 'bg-2'],
    });
    assert.equal(panel.length, 2);
  });

  it('detects background dispatch across assistant messages in the same turn', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'go' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-task',
            toolCallId: 't1',
            state: 'output-available',
            output: { background: true, task_id: 'bg-1' },
          },
        ],
      },
      {
        id: 'a2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'workers running' }],
      },
    ] as UIMessage[];
    assert.equal(coordinatorTurnHasBackgroundDispatch(messages), true);
    assert.deepEqual(collectCoordinatorDispatchTaskIds(messages), ['bg-1']);
  });

  it('detects background worker dispatch on the last assistant message', () => {
    assert.equal(assistantDispatchedBackgroundWorkers(awaitingAssistant), true);
    assert.equal(isCoordinatorTurnUnsettled([awaitingAssistant], []), true);
  });

  it('stays unsettled until notifications land even when tasks are terminal', () => {
    const batch = [
      { id: 'bg-1', status: 'done' },
      { id: 'bg-2', status: 'done' },
    ];
    assert.equal(hasActiveBackgroundTasks(batch), false);
    assert.equal(
      isCoordinatorTurnUnsettled([awaitingAssistant], batch, { notificationsReady: false }),
      true,
    );
    assert.equal(
      isCoordinatorTurnUnsettled([awaitingAssistant], batch, { notificationsReady: true }),
      true,
    );
    const fp = backgroundTaskBatchFingerprint(batch);
    assert.match(fp ?? '', /bg-1:done/);
  });

  it('mergePanelBackgroundTasks keeps optimistic rows before API catches up', () => {
    const messages = [
      {
        id: 'a2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-task',
            toolCallId: 'new',
            state: 'output-available',
            output: {
              background: true,
              task_id: 'pending-1',
              description: '工厂维度分析',
            },
          },
        ],
      },
    ] as UIMessage[];
    const merged = mergePanelBackgroundTasks(messages, []);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.id, 'pending-1');
    assert.equal(merged[0]?.status, 'queued');
    assert.equal(merged[0]?.label, '工厂维度分析');
  });

  it('mergePanelBackgroundTasks overlays API status onto optimistic rows', () => {
    const messages = [
      {
        id: 'a2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-task',
            toolCallId: 'new',
            state: 'output-available',
            output: { background: true, task_id: 't-1', description: '分析 A' },
          },
        ],
      },
    ] as UIMessage[];
    const merged = mergePanelBackgroundTasks(messages, [
      { id: 't-1', status: 'running', label: '分析 A', agentId: 'subagent-explore' },
    ]);
    assert.equal(merged[0]?.status, 'running');
  });

  it('collectSubagentTasksFromThreadMessages includes inline sync task results', () => {
    const rows = collectSubagentTasksFromThreadMessages([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolName: 'task',
            toolCallId: 'call-sync',
            args: { description: '生产期量数据分析' },
            result: {
              background: false,
              task_id: null,
              summary: 'Let me start by finding the data source.',
            },
          },
        ],
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, 'done');
    assert.equal(rows[0]?.label, '生产期量数据分析');
    assert.match(rows[0]?.result ?? '', /data source/);
  });

  it('collectOptimisticBackgroundTasksFromThreadMessages keeps background ids only', () => {
    const rows = collectOptimisticBackgroundTasksFromThreadMessages([
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolName: 'task',
            args: { description: '工序流程分析', run_in_background: true },
            result: {
              background: true,
              task_id: 'abc-123',
              description: '工序流程分析',
              subagent_type: 'explore',
            },
          },
        ],
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, 'abc-123');
    assert.equal(rows[0]?.label, '工序流程分析');
  });

  it('mergePanelBackgroundTasksFromThread preserves dispatch order', () => {
    const thread = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolName: 'task',
            result: { background: true, task_id: 't2', description: 'B' },
          },
          {
            type: 'tool-call',
            toolName: 'task',
            result: { background: true, task_id: 't1', description: 'A' },
          },
        ],
      },
    ];
    const merged = mergePanelBackgroundTasksFromThread(thread, [
      { id: 't1', status: 'done', agentId: 'subagent' },
      { id: 't2', status: 'running', agentId: 'subagent' },
    ]);
    assert.deepEqual(
      merged.map((row) => row.id),
      ['t2', 't1'],
    );
  });
});
