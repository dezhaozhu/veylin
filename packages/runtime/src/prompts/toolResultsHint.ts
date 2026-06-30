export const SUMMARIZE_TOOL_RESULTS_SECTION = `# Tool result retention

When tool results may be cleared from context later, record load-bearing facts in your reply before moving on. Do not assume an old tool output will still be visible on the next turn.`;

export function getSummarizeToolResultsSection(): string {
  return SUMMARIZE_TOOL_RESULTS_SECTION;
}
