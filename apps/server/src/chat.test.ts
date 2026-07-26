import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildWorkspacePanelHintBlock,
  textOfMessage,
  toAgentMessages,
} from './chat.js';
import {
  clearSuspendedRunsForTest,
  consumeSuspendedRun,
  observeSuspensionChunk,
} from './chat-suspension-registry.js';
import { formatTableContextBlock } from './table-store.js';

describe('chat message conversion', () => {
  it('keeps answered ask_user_question as native tool protocol', async () => {
    const assistantWithAnswer = {
      role: 'assistant',
      parts: [
        {
          type: 'tool-ask_user_question',
          toolCallId: 'ask-1',
          state: 'output-available',
          input: { questions: [] },
          output: {
            answers: {
              '你今天想聊什么？': '工作相关',
            },
          },
        },
      ],
    };

    assert.equal(textOfMessage(assistantWithAnswer), '');

    const converted = await toAgentMessages([
      {
        role: 'user',
        parts: [{ type: 'text', text: '调用工具问我问题' }],
      },
      assistantWithAnswer,
    ]);

    assert.deepEqual(converted.map((message) => message.role), ['user', 'assistant', 'tool']);
    assert.equal(
      (converted[1]?.content as Array<{ type?: string }>)[0]?.type,
      'tool-call',
    );
    assert.equal(
      (converted[2]?.content as Array<{ type?: string }>)[0]?.type,
      'tool-result',
    );
  });

  it('preserves ordinary user text and text attachments', async () => {
    const converted = await toAgentMessages([
      {
        role: 'user',
        parts: [
          { type: 'text', text: '请读取附件' },
          {
            type: 'file',
            mediaType: 'text/plain',
            filename: 'note.txt',
            url: `data:text/plain;base64,${Buffer.from('hello attachment').toString('base64')}`,
          },
        ],
      },
    ]);

    assert.equal(converted[0]?.role, 'user');
    const content = converted[0]?.content as Array<{ type: string; text: string }>;
    assert.deepEqual(content[0], { type: 'text', text: '请读取附件' });
    assert.equal(content[1]?.type, 'text');
    assert.match(content[1]?.text ?? '', /note\.txt/);
    assert.match(content[1]?.text ?? '', /hello attachment/);
  });
});

describe('native suspension registry', () => {
  it('passes through suspension data and atomically authorizes one resume', () => {
    clearSuspendedRunsForTest();
    const owner = {
      threadId: 'thread-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      agentId: 'agent-1',
    };
    const chunk = {
      type: 'data-tool-call-suspended',
      id: 'call-1',
      data: {
        state: 'data-tool-call-suspended',
        runId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'ask_user_question',
        suspendPayload: { questions: [{ question: 'Pick?' }] },
      },
    };

    assert.strictEqual(observeSuspensionChunk(chunk, owner), chunk);
    assert.equal(
      consumeSuspendedRun({ ...owner, userId: 'other-user' }, 'run-1', 'call-1'),
      null,
    );
    const record = consumeSuspendedRun(owner, 'run-1', 'call-1');
    assert.deepEqual(record?.suspendPayload, chunk.data.suspendPayload);
    assert.equal(consumeSuspendedRun(owner, 'run-1', 'call-1'), null);
  });
});

describe('workspace context blocks', () => {
  it('formats table snapshot with row counts and sample rows', () => {
    const block = formatTableContextBlock([
      {
        id: 'sheet-1',
        name: 'Sheet 1',
        columns: [
          { key: 'creator', name: '创建人' },
          { key: 'wbs', name: 'WBS' },
        ],
        rowCount: 49350,
        sampleRows: [{ row_id: 'r1', creator: '寿天科', wbs: 'Z-221524A0' }],
      },
    ]);
    assert.match(block, /49350 row/);
    assert.match(block, /Sheet 1/);
    assert.match(block, /table_get/);
    assert.match(block, /寿天科/);
  });

  it('hints table panel focus', () => {
    const block = buildWorkspacePanelHintBlock({ activePanel: 'table' });
    assert.match(block, /表格/);
    assert.match(block, /table_sheets/);
  });

  it('hints web panel with url', () => {
    const block = buildWorkspacePanelHintBlock({
      activePanel: 'web',
      webUrl: 'https://intranet.example/page',
      webTitle: 'Intranet',
    });
    assert.match(block, /read_open_page/);
    assert.match(block, /intranet\.example/);
  });

  it('lists open web tabs with tabIds for multi-tab read', () => {
    const block = buildWorkspacePanelHintBlock({
      activePanel: 'table',
      openWebTabs: [
        {
          tabId: 'web-a',
          url: 'https://a.example',
          title: 'A',
          isActive: false,
        },
        {
          tabId: 'web-b',
          url: 'https://b.example',
          title: 'B',
          isActive: true,
        },
      ],
    });
    assert.match(block, /tabId=web-a/);
    assert.match(block, /tabId=web-b/);
    assert.match(block, /Pass `tabId`/);
  });

  it('hints rag panel', () => {
    const block = buildWorkspacePanelHintBlock({ activePanel: 'rag' });
    assert.match(block, /knowledge_search/);
    assert.match(block, /知识库/);
  });
});
