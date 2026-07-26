/** Tools completed on the client; the server must not finish the same run. */
export const FRONTEND_SUSPEND_TOOL_NAMES = ['ask_user_question', 'read_open_page'] as const;

export type FrontendSuspendToolName = (typeof FRONTEND_SUSPEND_TOOL_NAMES)[number];

type NamedToolPart = {
  type?: string;
  toolName?: string;
};

export function getFrontendSuspendToolName(
  part: NamedToolPart,
): FrontendSuspendToolName | null {
  const type = part.type;
  if (!type?.startsWith('tool-')) return null;
  const name = type === 'tool-call' ? part.toolName : type.slice('tool-'.length);
  return FRONTEND_SUSPEND_TOOL_NAMES.includes(name as FrontendSuspendToolName)
    ? (name as FrontendSuspendToolName)
    : null;
}
