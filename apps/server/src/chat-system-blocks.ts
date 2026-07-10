import {
  getSummarizeToolResultsSection,
  resolveSystemPromptSections,
  systemPromptSection,
  uncachedSystemPromptSection,
} from '@veylin/runtime';

export type ChatSystemBlockInput = {
  skillsCatalog: string;
  skillBlock: string;
  rulesBlock: string;
  planModeBlock: string;
  goalBlock: string;
  loopBlock: string;
  tableBlock: string;
  knowledgeBlock: string;
  workspacePanelBlock: string;
  reminderBlock: string;
  orchestrationBlock: string;
  localeBlock: string;
  attachedBrowserBlock: string;
};

function blockOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Cached + dynamic system sections for the main chat path. */
export async function buildChatSystemBlocks(input: ChatSystemBlockInput): Promise<string> {
  const sections = [
    systemPromptSection('summarize_tool_results', () => getSummarizeToolResultsSection()),
    uncachedSystemPromptSection('skills_catalog', () => blockOrNull(input.skillsCatalog)),
    uncachedSystemPromptSection('activated_skills', () => blockOrNull(input.skillBlock)),
    uncachedSystemPromptSection('rules', () => blockOrNull(input.rulesBlock)),
    uncachedSystemPromptSection('plan_mode', () => blockOrNull(input.planModeBlock)),
    uncachedSystemPromptSection('goal', () => blockOrNull(input.goalBlock)),
    uncachedSystemPromptSection('loop', () => blockOrNull(input.loopBlock)),
    uncachedSystemPromptSection('table_context', () => blockOrNull(input.tableBlock)),
    uncachedSystemPromptSection('knowledge_context', () => blockOrNull(input.knowledgeBlock)),
    uncachedSystemPromptSection('workspace_panel', () => blockOrNull(input.workspacePanelBlock)),
    uncachedSystemPromptSection('reminders', () => blockOrNull(input.reminderBlock)),
    uncachedSystemPromptSection('orchestration', () => blockOrNull(input.orchestrationBlock)),
    uncachedSystemPromptSection('locale', () => blockOrNull(input.localeBlock)),
    uncachedSystemPromptSection('attached_browser', () => blockOrNull(input.attachedBrowserBlock)),
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
