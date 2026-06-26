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
- **Fork**: omit both \`subagent_type\` and \`agent_id\` to fork yourself — the child inherits this conversation and runs in the background. Use for research or implementation where context is already loaded. Provide a short \`description\` (name) and a directive-style \`prompt\` (what to do, not background).
- Use \`description\` as a short human-readable label (shown in the UI).
- Independent investigations: dispatch multiple \`task\` calls with \`run_in_background: true\` in the **same turn** — do not wait serially when work is parallelizable.
- Subagents cannot dispatch further subagents or forks.

## Background results
Worker results arrive as user-role messages containing \`<task-notification>\` XML (not written by you).
- Do **not** fabricate or predict subagent results before a notification arrives.
- If the user asks while a background task is still running, report status only — not guessed output.
- Use \`task_continue\` with the \`task_id\` from the notification to send a follow-up to the same worker thread.

## When to use background mode
- Long research, multi-file exploration, verification runs, forks, or any task likely to take many tool turns → \`run_in_background: true\` (forks default to background).
- Quick, narrow lookups you need inline → synchronous (default for presets only).
</system-reminder>`;
}
