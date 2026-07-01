import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildWorkspacePanelHintBlock,
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
    assert.match(block, /table_list_sheets/);
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

  it('hints rag panel', () => {
    const block = buildWorkspacePanelHintBlock({ activePanel: 'rag' });
    assert.match(block, /knowledge_search/);
    assert.match(block, /知识库/);
  });
});
