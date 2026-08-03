import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildProjectPinBlock,
  buildWorkspacePanelHintBlock,
  projectPinLabel,
  textOfMessage,
  toAgentMessages,
} from './chat.js';
import { formatTableContextBlock } from './table-store.js';

describe('chat message conversion', () => {
  it('turns answered ask_user_question into continuation text', async () => {
    const assistantWithAnswer = {
      role: 'assistant',
      parts: [
        {
          type: 'tool-ask_user_question',
          toolCallId: 'ask-1',
          state: 'output-available',
          providerExecuted: true,
          output: {
            answers: {
              '你今天想聊什么？': '工作相关',
            },
          },
        },
      ],
    };

    assert.match(
      textOfMessage(assistantWithAnswer),
      /User has answered your questions/,
    );

    const converted = await toAgentMessages([
      {
        role: 'user',
        parts: [{ type: 'text', text: '调用工具问我问题' }],
      },
      assistantWithAnswer,
    ]);

    assert.deepEqual(converted, [
      { role: 'user', content: '调用工具问我问题' },
      {
        role: 'user',
        content:
          'User has answered your questions: "你今天想聊什么？"="工作相关". You can now continue with the user\'s answers in mind.',
      },
    ]);
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
