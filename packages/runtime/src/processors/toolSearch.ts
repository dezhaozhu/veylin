import { toolKeywords, type BuiltinToolId } from '@veylin/tools';

/**
 * Dynamic tool selection for small flash models with tight context windows.
 * Given the user's request text, score tools by keyword overlap and return the
 * top-N ids plus any always-on tools. Mirrors the agent's ToolSearchTool idea.
 */
export function selectTools(
  query: string,
  available: BuiltinToolId[],
  opts: { topN?: number; alwaysOn?: BuiltinToolId[] } = {},
): BuiltinToolId[] {
  const topN = opts.topN ?? 5;
  const alwaysOn = opts.alwaysOn ?? (['todo_write', 'ask_user_question'] as BuiltinToolId[]);
  const q = query.toLowerCase();

  const scored = available
    .filter((id) => !alwaysOn.includes(id))
    .map((id) => {
      const keywords = toolKeywords[id] ?? [];
      const score = keywords.reduce((acc, kw) => (q.includes(kw) ? acc + 1 : acc), 0);
      return { id, score };
    })
    .sort((a, b) => b.score - a.score);

  const picked = scored.filter((s) => s.score > 0).slice(0, topN).map((s) => s.id);
  // If nothing matched, fall back to a small safe default set.
  const base = picked.length > 0 ? picked : (['file_read', 'list_dir', 'grep'] as BuiltinToolId[]);

  return Array.from(new Set([...alwaysOn, ...base])).filter((id) => available.includes(id));
}
