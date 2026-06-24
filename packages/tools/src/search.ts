import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { toolKeywords, type BuiltinToolId } from './registry';

type McpToolMeta = { id: string; description: string };

function scoreQuery(query: string, keywords: string[]): number {
  const q = query.toLowerCase();
  return keywords.reduce((acc, kw) => (q.includes(kw) ? acc + 1 : acc), 0);
}

/**
 * Lets the agent discover tools by intent. Indexes builtins plus MCP tools from
 * requestContext.mcpToolNames. Discovered ids are merged into the active tool map
 * for the remainder of the run via requestContext.discoveredToolIds.
 */
export const toolSearch = createTool({
  id: 'tool_search',
  description:
    'Search the available tools by intent and return ranked tool ids with descriptions. ' +
    'Call this FIRST whenever you are unsure which tool can accomplish a step — it also unlocks ' +
    'discovered tools for the rest of the run. Search with a short description of the goal ' +
    '(e.g. "edit a file", "query the schedule", "fetch a web page") rather than a guessed tool name.',
  inputSchema: z.object({
    query: z.string().describe('What you want to do, e.g. "edit a file" or "run a command"'),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  outputSchema: z.object({
    tools: z.array(z.object({ id: z.string(), score: z.number(), description: z.string() })),
  }),
  execute: async (input, ctx) => {
    const q = input.query.toLowerCase();
    const mcpTools = (ctx?.requestContext?.get('mcpToolNames') as McpToolMeta[] | undefined) ?? [];

    const builtinIds = Object.keys(toolKeywords) as BuiltinToolId[];
    const ranked = [
      ...builtinIds.map((id) => ({
        id,
        score: scoreQuery(q, toolKeywords[id] ?? []),
        description: id.replace(/_/g, ' '),
      })),
      ...mcpTools.map((t) => ({
        id: t.id,
        score: scoreQuery(q, t.description.toLowerCase().split(/\W+/).filter(Boolean)),
        description: t.description,
      })),
    ]
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit);

    const fallback =
      ranked.length > 0
        ? ranked
        : builtinIds.slice(0, input.limit).map((id) => ({
            id,
            score: 0,
            description: id.replace(/_/g, ' '),
          }));

    const discovered = fallback.map((t) => t.id);
    const prev = (ctx?.requestContext?.get('discoveredToolIds') as string[] | undefined) ?? [];
    ctx?.requestContext?.set('discoveredToolIds', Array.from(new Set([...prev, ...discovered])));

    return { tools: fallback };
  },
});
