import {
  getSummarizeToolResultsSection,
  resolveSystemPromptSections,
  systemPromptSection,
  uncachedSystemPromptSection,
} from '@veylin/runtime';

import { formatNowBlock } from './now-block.js';

export type ChatSystemBlockInput = {
  /** 用户本地时区(客户端给);缺省用本机时区。见 now-block.ts。 */
  timeZone?: string;
  skillsCatalog: string;
  skillBlock: string;
  rulesBlock: string;
  planModeBlock: string;
  goalBlock: string;
  loopBlock: string;
  tableBlock: string;
  viewer3dBlock?: string;
  knowledgeBlock: string;
  workspacePanelBlock: string;
  reminderBlock: string;
  orchestrationBlock: string;
  localeBlock: string;
  attachedBrowserBlock: string;
  workingMemoryBlock?: string;
  projectPinBlock?: string;
  /** Compass 接地块(compass 连上时才有内容)。见 compass-grounding.ts。 */
  compassGroundingBlock?: string;
};

function blockOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Cached + dynamic system sections for the main chat path. */
export async function buildChatSystemBlocks(input: ChatSystemBlockInput): Promise<string> {
  const sections = [
    systemPromptSection('summarize_tool_results', () => getSummarizeToolResultsSection()),
    // **必须 uncached**:sectionCache 是进程级、只按名字做键,缓存住就等于永远
    // 停在第一个请求的那一刻 —— 那比不给时间更糟(它会理直气壮地报错日期)。
    uncachedSystemPromptSection('now', () =>
      blockOrNull(formatNowBlock(new Date(), input.timeZone)),
    ),
    uncachedSystemPromptSection('working_memory', () => blockOrNull(input.workingMemoryBlock ?? '')),
    uncachedSystemPromptSection('skills_catalog', () => blockOrNull(input.skillsCatalog)),
    uncachedSystemPromptSection('activated_skills', () => blockOrNull(input.skillBlock)),
    uncachedSystemPromptSection('rules', () => blockOrNull(input.rulesBlock)),
    uncachedSystemPromptSection('plan_mode', () => blockOrNull(input.planModeBlock)),
    uncachedSystemPromptSection('goal', () => blockOrNull(input.goalBlock)),
    uncachedSystemPromptSection('loop', () => blockOrNull(input.loopBlock)),
    uncachedSystemPromptSection('table_context', () => blockOrNull(input.tableBlock)),
    uncachedSystemPromptSection('viewer3d_context', () => blockOrNull(input.viewer3dBlock ?? '')),
    uncachedSystemPromptSection('knowledge_context', () => blockOrNull(input.knowledgeBlock)),
    uncachedSystemPromptSection('workspace_panel', () => blockOrNull(input.workspacePanelBlock)),
    uncachedSystemPromptSection('reminders', () => blockOrNull(input.reminderBlock)),
    uncachedSystemPromptSection('orchestration', () => blockOrNull(input.orchestrationBlock)),
    uncachedSystemPromptSection('locale', () => blockOrNull(input.localeBlock)),
    uncachedSystemPromptSection('attached_browser', () => blockOrNull(input.attachedBrowserBlock)),
    uncachedSystemPromptSection('project_pin', () => blockOrNull(input.projectPinBlock ?? '')),
    // 必须 uncached:值取决于本请求是否连上 compass 与项目钉定,而 sectionCache
    // 是进程级、只按名字做键(systemPromptSections.ts:9)——用 cached 版会让第一个
    // 请求的结果永久钉住,并跨租户泄漏/屏蔽。
    uncachedSystemPromptSection('compass_grounding', () =>
      blockOrNull(input.compassGroundingBlock ?? ''),
    ),
  ];

  const values = await resolveSystemPromptSections(sections);
  return values.filter((v): v is string => Boolean(v)).join('\n\n');
}

export type AgentRunSystemBlockInput = {
  skillsCatalog: string;
  rulesBlock: string;
};

/** Lighter system block chain for automation / workflow agent runs. */
export async function buildAgentRunSystemBlocks(input: AgentRunSystemBlockInput): Promise<string> {
  const sections = [
    systemPromptSection('summarize_tool_results', () => getSummarizeToolResultsSection()),
    uncachedSystemPromptSection('skills_catalog', () => blockOrNull(input.skillsCatalog)),
    uncachedSystemPromptSection('rules', () => blockOrNull(input.rulesBlock)),
  ];
  const values = await resolveSystemPromptSections(sections);
  return values.filter((v): v is string => Boolean(v)).join('\n\n');
}
