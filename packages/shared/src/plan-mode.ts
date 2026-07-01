/** Plan mode tool ids and inference from chat history (shared web + server contract). */

export const ENTER_PLAN_MODE_TOOL = 'enter_plan_mode' as const;
export const EXIT_PLAN_MODE_TOOL = 'exit_plan_mode' as const;

export type PlanModeToolName = typeof ENTER_PLAN_MODE_TOOL | typeof EXIT_PLAN_MODE_TOOL;

type ToolPart = {
  type?: string;
  state?: string;
  output?: { planMode?: boolean };
};

type UiMessageLike = {
  role?: string;
  parts?: readonly unknown[];
};

type ThreadToolCall = {
  type?: string;
  toolName?: string;
  result?: unknown;
};

type ThreadMessageLike = {
  role?: string;
  content?: readonly ThreadToolCall[];
};

function applyPlanToolResult(_mode: boolean | null, toolName: string, result: unknown): boolean {
  if (toolName === ENTER_PLAN_MODE_TOOL) {
    const out = result as { planMode?: boolean };
    return out.planMode ?? true;
  }
  if (toolName === EXIT_PLAN_MODE_TOOL) {
    return false;
  }
  return _mode ?? false;
}

/** Infer plan mode from AI SDK UI message parts (tool-* types). */
export function inferPlanModeFromMessages(
  messages: readonly UiMessageLike[],
): boolean | null {
  let mode: boolean | null = null;

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.parts?.length) continue;
    for (const part of message.parts) {
      const p = part as ToolPart;
      if (p.state !== 'output-available') continue;
      if (p.type === `tool-${ENTER_PLAN_MODE_TOOL}`) {
        mode = p.output?.planMode ?? true;
      } else if (p.type === `tool-${EXIT_PLAN_MODE_TOOL}`) {
        mode = false;
      }
    }
  }

  return mode;
}

/** Infer plan mode from assistant-ui thread messages (tool-call content parts). */
export function inferPlanModeFromThreadMessages(
  messages: readonly ThreadMessageLike[],
): boolean | null {
  let mode: boolean | null = null;

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.content?.length) continue;
    for (const part of message.content) {
      if (part.type !== 'tool-call') continue;
      const name = part.toolName ?? '';
      if (part.result == null) continue;
      if (name === ENTER_PLAN_MODE_TOOL || name === EXIT_PLAN_MODE_TOOL) {
        mode = applyPlanToolResult(mode, name, part.result);
      }
    }
  }

  return mode;
}
