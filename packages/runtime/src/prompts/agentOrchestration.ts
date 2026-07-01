/**
 * Orchestration guidance for the main (full-toolset) agent — aligned with
 * Claude Code coordinator / Agent-tool semantics.
 */
export function buildAgentOrchestrationBlock(customAgentIds: string[] = []): string {
  const customLine =
    customAgentIds.length > 0
      ? `\n- Custom agent packages (use \`agent_id\`): ${customAgentIds.join(', ')}.`
      : '';
  return `<system-reminder>
# Subagent orchestration (task tool)

You can delegate scoped work to specialized subagents with the \`task\` tool, continue them with \`task_continue\`, and manage background runs with \`task_list\` / \`task_get\` / \`task_stop\`.

## Dispatch rules
- Pick \`subagent_type\` by need: explore (read-only search), plan (read-only design), editor (scoped edits), verification (independent testing), general-purpose (mixed work).${customLine}
- **Fork**: omit both \`subagent_type\` and \`agent_id\` to fork yourself — the child inherits this conversation. Use for research or implementation where context is already loaded. Provide a short \`description\` (name) and a directive-style \`prompt\` (what to do).
- Use \`description\` as a short human-readable label (shown in the UI).
- Each \`task\` call **runs the worker and returns its result inline** (like Claude Code's Agent tool). For independent work, dispatch **multiple \`task\` calls in the same step** — they run concurrently and you resume once all return. Do not wait serially when work is parallelizable.
- Subagents cannot dispatch further subagents or forks.

## Using worker results
Each \`task\` / \`task_continue\` call returns the worker's result text as the tool result — it is already in your context when you continue.
- Do **not** fabricate or predict subagent results before the call returns.
- After all workers in a batch return, produce the consolidated synthesis the user asked for — do not stop at "please wait".
- **Synthesis output**: deliver one clear user-facing report. Integrate worker findings; do not paste each result verbatim or repeat the same sections twice — the user should see synthesis, not duplicated subagent dumps.
- Use \`task_continue\` with the \`task_id\` from a prior dispatch to send a follow-up to the same worker thread.
</system-reminder>`;
}
