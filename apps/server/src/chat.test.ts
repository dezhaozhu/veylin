import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildProjectPinBlock,
  buildWorkspacePanelHintBlock,
  projectPinLabel,
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

describe('projectPinLabel (v3: project display name + source labels, never a raw entry name)', () => {
  it('a single-source default project whose name IS the source label collapses to just the name', () => {
    assert.equal(projectPinLabel({ name: '锅炉厂', sources: ['guolu'] }), '锅炉厂');
  });

  it('a composed project lists its source labels after the name', () => {
    assert.equal(
      projectPinLabel({ name: '对比分析', sources: ['guolu', 'shangzhong'] }),
      '对比分析(数据源: 锅炉厂、上重)',
    );
  });

  it('an unknown source code falls back to the raw code', () => {
    assert.equal(
      projectPinLabel({ name: '锻件试点', sources: ['duanjian'] }),
      '锻件试点(数据源: duanjian)',
    );
  });
});

describe('buildProjectPinBlock (audit fix #3: thread-move boundary marker; 全项目制: personal-area hint)', () => {
  it('an unpinned thread gets the personal-area hint, not an empty block (no silent auto-pin)', () => {
    const block = buildProjectPinBlock(null);
    assert.match(block, /当前会话在「个人」区/);
    assert.match(block, /侧边栏选择项目新建会话/);
    assert.match(block, /会话菜单将本会话移动到项目/);
  });

  it('the personal-area hint still carries the move marker when the thread moved OUT of a project', () => {
    // movedFrom is display-only and printed as-is — legacy entry names from
    // pre-migration moves keep rendering.
    const block = buildProjectPinBlock(null, {
      movedFrom: 'compass-guolu',
      movedAt: '2026-07-01T00:00:00.000Z',
    });
    assert.match(block, /当前会话在「个人」区/);
    assert.match(block, /本会话曾属于项目 compass-guolu\(2026-07-01T00:00:00\.000Z 移动\)/);
  });

  it('plain pin reminder when there is no move (label = project display label, not an entry name)', () => {
    const block = buildProjectPinBlock(projectPinLabel({ name: '锅炉厂', sources: ['guolu'] }));
    assert.match(block, /当前数据项目: 锅炉厂/);
    assert.doesNotMatch(block, /曾属于项目/);
  });

  it('plain pin reminder when move is passed but movedFrom is null', () => {
    const block = buildProjectPinBlock('锅炉厂', { movedFrom: null, movedAt: null });
    assert.doesNotMatch(block, /曾属于项目/);
  });

  it('appends the boundary marker with movedFrom and movedAt when the thread moved', () => {
    const block = buildProjectPinBlock('上重', {
      movedFrom: 'compass-guolu',
      movedAt: '2026-07-01T00:00:00.000Z',
    });
    assert.match(block, /当前数据项目: 上重/);
    assert.match(block, /本会话曾属于项目 compass-guolu\(2026-07-01T00:00:00\.000Z 移动\)/);
    assert.match(block, /此前的对话内容属于原项目,不可作为当前项目的数据依据/);
  });
});

describe('项目级指令进系统块', () => {
  it('**写了就要喂给模型** —— 不喂的话那个输入框只是个装饰', () => {
    const block = buildProjectPinBlock('上重', null, '只看锻件分厂,别碰冶铸。');
    assert.match(block, /只看锻件分厂/);
  });

  it('标明这是用户为这个项目写的 —— 和系统规则的权威不同,混在一起模型无从判断', () => {
    const block = buildProjectPinBlock('上重', null, '某条约定');
    assert.match(block, /用户写给这个项目的/);
  });

  it('没写就什么也不加,不放一个空标题', () => {
    const block = buildProjectPinBlock('上重', null, '   ');
    assert.doesNotMatch(block, /该项目的说明/);
  });

  it('**没钉项目时不带说明** —— 那段话属于项目,不属于这个会话', () => {
    const block = buildProjectPinBlock(null, null, '某条约定');
    assert.doesNotMatch(block, /某条约定/);
  });
});
