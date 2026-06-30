/** System reminder injected while a thread is in plan mode (Claude Code–style contract). */

export function buildPlanModeBlock(): string {
  return `<system-reminder>
Plan mode is active for this thread. You must not execute mutating work yet — no table writes, workspace_config changes, subagent tasks, MCP actions, or other state-changing tools. Use read-only exploration (web_fetch, read_open_page, knowledge_search if available, todo_write for planning) to investigate, present a clear plan to the user, and call exit_plan_mode only when the plan is ready and the user can approve execution.
</system-reminder>`;
}
