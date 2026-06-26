import type { Runtime } from '@veylin/runtime';
import { RequestContext } from '@mastra/core/di';
import { ensureThreadState, activateSkill, syncWorkingMemory } from './thread-state';
import {
  listMergedSkills,
  resolveSkillContent,
  buildSkillsCatalogBlock,
} from './skills-store';
import { listRules, buildRulesMemoryBlock } from './rules-store';
import { createMcpClient, listActiveMcpServerNames } from './mcp-store';
import { applyTenantModelSettings } from './model-settings-store';
import { refreshAgentPackages, requireAgent } from './agent-packages-sync';

export interface RunAgentOptions {
  runtime: Runtime;
  tenantId: string;
  userId: string;
  threadId: string;
  agentId: string;
  prompt: string;
  eventContext?: Record<string, unknown>;
  title?: string;
}

export interface RunAgentResult {
  text: string;
}

/** Shared Mastra agent invocation used by Automate and Workflow run_agent nodes. */
export async function runAgentPrompt(options: RunAgentOptions): Promise<RunAgentResult> {
  const {
    runtime,
    tenantId,
    userId,
    threadId,
    agentId,
    prompt,
    eventContext,
    title,
  } = options;

  const identity = { threadId, tenantId, resourceId: userId };
  await ensureThreadState(identity);
  await applyTenantModelSettings(tenantId);
  await refreshAgentPackages(runtime);

  const eventBlock =
    eventContext && Object.keys(eventContext).length > 0
      ? `\n\n## Event Context\n${JSON.stringify(eventContext, null, 2)}`
      : '';
  const userPrompt = `${prompt}${eventBlock}`;

  const mergedSkills = await listMergedSkills(runtime, tenantId, agentId);
  const enabledSkillNames = mergedSkills.filter((s) => s.enabled).map((s) => s.name);
  const rules = await listRules(tenantId, userId, agentId);
  const skillsCatalog = buildSkillsCatalogBlock(mergedSkills);
  const rulesBlock = buildRulesMemoryBlock(rules, userPrompt);
  const systemBlocks = [skillsCatalog, rulesBlock].filter(Boolean).join('\n\n');

  const declaredMcp = runtime.definitions.get(agentId)?.definition.mcpServers ?? [];
  const activeMcp = await listActiveMcpServerNames(tenantId, declaredMcp);
  let mcpToolsets: Record<string, unknown> = {};
  let mcpClient: Awaited<ReturnType<typeof createMcpClient>> | null = null;
  if (activeMcp.length > 0) {
    try {
      mcpClient = await createMcpClient(tenantId);
      const all = (await mcpClient.listToolsets().catch(() => ({}))) as Record<string, unknown>;
      mcpToolsets = Object.fromEntries(
        Object.entries(all).filter(([server]) => activeMcp.includes(server)),
      );
    } catch {
      mcpToolsets = {};
    }
  }

  const requestContext = new RequestContext();
  requestContext.set('tenantId', tenantId);
  requestContext.set('userId', userId);
  requestContext.set('threadId', threadId);
  requestContext.set('toolQuery', userPrompt);
  requestContext.set('discoveredToolIds', []);
  requestContext.set('enabledSkillNames', enabledSkillNames);
  requestContext.set(
    'resolveSkillByName',
    async (name: string) => resolveSkillContent(runtime, tenantId, agentId, name),
  );
  requestContext.set('onSkillActivated', async ({ name }: { name: string }) => {
    const content = await resolveSkillContent(runtime, tenantId, agentId, name);
    if (!content) return;
    const skills = await activateSkill(threadId, name, content);
    await syncWorkingMemory(runtime.memory, identity, skills, null);
  });

  const agent = requireAgent(runtime, agentId);
  const messages = systemBlocks
    ? [
        { role: 'system', content: systemBlocks },
        { role: 'user', content: userPrompt },
      ]
    : [{ role: 'user', content: userPrompt }];

  try {
    const result = (await agent.generate(messages as never, {
      memory: { thread: threadId, resource: userId },
      requestContext,
      toolsets: mcpToolsets,
    } as never)) as { text?: string };

    const text = result?.text ?? '';
    await runtime.memory.saveMessages({
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          createdAt: new Date(),
          threadId,
          resourceId: userId,
          content: {
            format: 2,
            parts: [{ type: 'text', text: text || '(no output)' }],
          },
        },
      ],
    } as never);

    return { text };
  } finally {
    await mcpClient?.disconnect?.().catch(() => undefined);
    void title;
  }
}
