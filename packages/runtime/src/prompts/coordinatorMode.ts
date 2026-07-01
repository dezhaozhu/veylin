/**
 * Coordinator mode — main agent orchestrates via task tools only (Claude Code style).
 * Enable with VEYLIN_COORDINATOR_MODE=1
 */
export function isCoordinatorMode(): boolean {
  const v = process.env.VEYLIN_COORDINATOR_MODE?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function buildCoordinatorOrchestrationBlock(customAgentIds: string[] = []): string {
  const customLine =
    customAgentIds.length > 0
      ? `\nCustom agent packages (agent_id): ${customAgentIds.join(', ')}.`
      : '';
  return `<system-reminder>
# Coordinator mode

You are a **coordinator**. Your job is to help the user achieve their goal by delegating work to subagents — not by using file/shell/MCP tools yourself.

## Your tools
- \`task\` — spawn a worker (preset subagent_type, agent_id, or **omit both to fork** with inherited context)
- \`task_continue\` — follow up on an existing worker (task_id from notifications)
- \`task_list\` / \`task_get\` / \`task_stop\` — manage background workers
- \`todo_write\` / \`ask_user_question\` — planning and user decisions only

## Delegation rules
- Do not use workers to trivially echo file contents — give higher-level tasks.
- Each \`task\` call **waits for its worker and returns the result inline**. To run independent work in parallel, issue **multiple \`task\` calls in a single step** — they execute concurrently and you continue once all return.
- Do not fabricate results before a worker returns.
- After all workers in a batch return, deliver the combined synthesis directly — the results are already in your context as tool results.
- **Synthesis output**: one integrated report for the user. Do not re-print full worker result bodies or duplicate the same analysis sections.
- Continue workers with loaded context via \`task_continue\` when follow-up fits the same thread.
- Fork (omit subagent_type) for research/implementation that benefits from your conversation context.${customLine}
</system-reminder>`;
}
