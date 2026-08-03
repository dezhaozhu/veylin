import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { clearSystemPromptSections } from '@veylin/runtime';
import { buildChatSystemBlocks, buildAgentRunSystemBlocks } from './chat-system-blocks.js';

describe('chat-system-blocks', () => {
  beforeEach(() => {
    clearSystemPromptSections();
  });

  it('includes cached summarize_tool_results section', async () => {
    const blocks = await buildChatSystemBlocks({
      skillsCatalog: '',
      skillBlock: '',
      rulesBlock: '',
      planModeBlock: '',
      goalBlock: '',
      loopBlock: '',
      tableBlock: '',
      viewer3dBlock: '',
      knowledgeBlock: '',
      workspacePanelBlock: '',
      reminderBlock: '',
      orchestrationBlock: '',
      localeBlock: '',
      attachedBrowserBlock: '',
    });

    assert.match(blocks, /Tool result retention/);
  });

  it('joins dynamic blocks in order', async () => {
    const blocks = await buildChatSystemBlocks({
      skillsCatalog: '## Skills',
      skillBlock: '## Active skill',
      rulesBlock: '',
      planModeBlock: '',
      goalBlock: '',
      loopBlock: '',
      tableBlock: '',
      viewer3dBlock: '',
      knowledgeBlock: '',
      workspacePanelBlock: '',
      reminderBlock: '',
      orchestrationBlock: '',
      localeBlock: '',
      attachedBrowserBlock: '',
    });

    assert.match(blocks, /## Skills/);
    assert.match(blocks, /## Active skill/);
    assert.ok(blocks.indexOf('## Skills') < blocks.indexOf('## Active skill'));
  });

  it('injects read-only working memory when provided', async () => {
    const blocks = await buildChatSystemBlocks({
      skillsCatalog: '',
      skillBlock: '',
      rulesBlock: '',
      planModeBlock: '',
      goalBlock: '',
      loopBlock: '',
      tableBlock: '',
      knowledgeBlock: '',
      workspacePanelBlock: '',
      reminderBlock: '',
      orchestrationBlock: '',
      localeBlock: '',
      attachedBrowserBlock: '',
      workingMemoryBlock:
        'WORKING_MEMORY_SYSTEM_INSTRUCTION (READ-ONLY):\n<working_memory_data>\n- Active focus: scheduling\n</working_memory_data>',
    });

    assert.match(blocks, /WORKING_MEMORY_SYSTEM_INSTRUCTION \(READ-ONLY\)/);
    assert.match(blocks, /Active focus: scheduling/);
  });

  it('builds lighter agent-run blocks', async () => {
    const blocks = await buildAgentRunSystemBlocks({
      skillsCatalog: 'catalog',
      rulesBlock: 'rules',
    });
    assert.match(blocks, /Tool result retention/);
    assert.match(blocks, /catalog/);
    assert.match(blocks, /rules/);
  });
});
