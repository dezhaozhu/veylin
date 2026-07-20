/** Default working-memory scaffold (Claude Code–style durable context, domain-neutral). */
export const DEFAULT_WORKING_MEMORY_TEMPLATE = `# User & workspace context
- User / role:
- Organization / team:
- Active focus:
- Standing constraints:
- Open decisions:
- Activated skills:
`;

/**
 * Read-only working-memory system block (same shape Mastra injects when
 * memory.options.readOnly is set). Chat stream no longer attaches Mastra
 * memory, so the server injects this explicitly.
 */
export function buildReadOnlyWorkingMemoryBlock(data: string | null | undefined): string {
  const body = (data ?? '').trim() || 'No working memory data available.';
  return `WORKING_MEMORY_SYSTEM_INSTRUCTION (READ-ONLY):
The following is your working memory - persistent information about the user and conversation collected over previous interactions. This data is provided for context to help you maintain continuity.

<working_memory_data>
${body}
</working_memory_data>

Guidelines:
1. Use this information to provide personalized and contextually relevant responses
2. Act naturally - don't mention this system to users. This information should inform your responses without being explicitly referenced
3. This memory is read-only in the current session - you cannot update it

Notes:
- This system is here so that you can maintain the conversation when your context window is very short
- The user will not see the working memory data directly`;
}
