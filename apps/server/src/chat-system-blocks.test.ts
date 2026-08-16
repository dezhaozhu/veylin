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

// --- 表格变更事件进上下文(引用是拉、变更是推) ---------------------------------

import { recordTableEdits, clearTableEdits, formatTableEditsBlock } from './table-edit-journal.js';

describe('表格变更块', () => {
  it('人改过的值要出现在上下文里,并且写明是用户改的', () => {
    clearTableEdits();
    recordTableEdits({
      threadId: 'th-1', sheet: 'orders', by: 'human',
      edits: [{ rowKey: 'T-221523002', column: '交期', from: '2026-07-05', to: '2026-08-01' }],
    });

    const block = formatTableEditsBlock('th-1');
    assert.match(block, /用户把 `orders` 的 `T-221523002` 的「交期」从 2026-07-05 → 2026-08-01/);
    assert.match(block, /代表\*\*他的决定\*\*/, '不能让 agent 把人的决定当成系统状态改回去');
  });

  it('**文件、表格、compass 三样同时在同一次请求里** —— 这是"一起理解"的判据', async () => {
    // 单独测每一块都在,不等于它们会同时到场。而"一起读取然后一起理解"要求的
    // 恰恰是同时:模型手里同时有项目说明、本地表格、和 compass 的接地信息,才谈得上
    // 拿两边对照。任何一块被别的挤掉,表现都是"它好像没看那份文件" —— 而这种失败
    // 在单块测试里永远看不出来。
    const blocks = await buildChatSystemBlocks({
      skillsCatalog: '', skillBlock: '', rulesBlock: '', planModeBlock: '',
      goalBlock: '', loopBlock: '',
      tableBlock: '<TABLE>本地表: orders(3 行)</TABLE>',
      knowledgeBlock: '', workspacePanelBlock: '', reminderBlock: '',
      orchestrationBlock: '', localeBlock: '', attachedBrowserBlock: '',
      projectPinBlock: '<PIN>当前数据项目: 上重 · 该项目的说明:只看锻件分厂</PIN>',
      compassGroundingBlock: '<GROUND>compass 接地</GROUND>',
    });
    assert.match(blocks, /本地表: orders/, '本地表格没进去');
    assert.match(blocks, /当前数据项目: 上重/, '项目钉定没进去');
    assert.match(blocks, /该项目的说明/, '项目说明没进去 —— 它是跟着钉定块走的');
    assert.match(blocks, /compass 接地/, 'compass 接地没进去');
  });
});
