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

  it('injects the compass grounding section when provided', async () => {
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
      compassGroundingBlock: '## 排产结果转述（Compass）\n只依据事实',
    });
    assert.match(blocks, /## 排产结果转述（Compass）/);
  });

  it('omits the compass grounding section when empty', async () => {
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
      compassGroundingBlock: '',
    });
    assert.doesNotMatch(blocks, /排产结果转述/);
  });

  it('does not carry the compass grounding section across calls without a clear (uncached regression guard)', async () => {
    // Regression guard for the binding constraint: compass_grounding MUST be
    // registered via uncachedSystemPromptSection, not systemPromptSection.
    // The process-global sectionCache is keyed only by section name
    // (systemPromptSections.ts), so if this section were ever switched to the
    // cached primitive, the first call's value would freeze for the rest of
    // the process — every later call, including this second one with an empty
    // block, would replay the first call's non-empty grounding text. Both
    // calls below happen inside this single it() body with NO intervening
    // clearSystemPromptSections(), so only the uncached primitive can make
    // the second call's output omit the grounding text.
    const base = {
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
    };

    const first = await buildChatSystemBlocks({
      ...base,
      compassGroundingBlock: '## 排产结果转述（Compass）\n只依据事实',
    });
    assert.match(first, /## 排产结果转述（Compass）/);

    const second = await buildChatSystemBlocks({
      ...base,
      compassGroundingBlock: '',
    });
    assert.doesNotMatch(second, /排产结果转述/);
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
