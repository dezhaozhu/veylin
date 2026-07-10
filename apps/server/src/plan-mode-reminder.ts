/** System reminder injected while a thread is in plan mode (Claude Code–style contract). */

export function buildPlanModeBlock(): string {
  return `<system-reminder>
Plan mode is active for this thread. You must not execute mutating work yet — no table writes, workspace_config changes, subagent tasks, MCP actions, or other state-changing tools. Use read-only exploration (web_fetch, read_open_page, knowledge_search if available, todo_write for planning) to investigate and draft a clear plan.

Clarifying questions: use \`ask_user_question\` during exploration to resolve requirements or trade-offs. Do **not** use \`ask_user_question\` to ask whether the plan may be executed — that approval is handled by \`exit_plan_mode\`. Call \`exit_plan_mode\` only when the plan is ready for the user to approve execution.
</system-reminder>`;
}
