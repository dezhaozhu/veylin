import type { HookBus } from '@veylin/hooks';

type AnyTool = {
  id?: string;
  execute?: (input: unknown, ctx?: unknown) => Promise<unknown> | unknown;
  [key: string]: unknown;
};

/**
 * Wrap a Mastra toolset map so every tool execute goes through Pre/Post/Failure hooks.
 */
export function wrapToolsetsWithHooks(
  toolsets: Record<string, unknown>,
  bus: HookBus,
  ctx: { threadId?: string; tenantId?: string },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [group, tools] of Object.entries(toolsets)) {
    if (!tools || typeof tools !== 'object') {
      out[group] = tools;
      continue;
    }
    const wrappedGroup: Record<string, unknown> = {};
    for (const [name, tool] of Object.entries(tools as Record<string, AnyTool>)) {
      wrappedGroup[name] = wrapOneTool(tool, name, bus, ctx);
    }
    out[group] = wrappedGroup;
  }
  return out;
}

function wrapOneTool(
  tool: AnyTool,
  name: string,
  bus: HookBus,
  ctx: { threadId?: string; tenantId?: string },
): AnyTool {
  const original = tool?.execute;
  if (typeof original !== 'function') return tool;

  return {
    ...tool,
    execute: async (input: unknown, execCtx?: unknown) => {
      const toolName = String(tool.id ?? name);
      const pre = await bus.emit(
        'PreToolUse',
        { tool_name: toolName, tool_input: input ?? {} },
        { threadId: ctx.threadId },
      );
      if (pre.additionalContext) {
        // Stash for chat layer if needed; tool path cannot inject system text easily.
        (execCtx as { requestContext?: { set?: (k: string, v: unknown) => void } } | undefined)
          ?.requestContext?.set?.('hookAdditionalContext', pre.additionalContext);
      }
      if (pre.decision === 'deny') {
        await bus.emit(
          'PermissionDenied',
          {
            tool_name: toolName,
            tool_input: input ?? {},
            reason: pre.reason ?? 'denied by PreToolUse hook',
          },
          { threadId: ctx.threadId },
        );
        throw new Error(pre.reason ?? `Tool ${toolName} denied by hook`);
      }
      const finalInput = pre.updatedInput ? { ...(input as object), ...pre.updatedInput } : input;
      try {
        const result = await original.call(tool, finalInput, execCtx);
        await bus.emit(
          'PostToolUse',
          {
            tool_name: toolName,
            tool_input: finalInput ?? {},
            tool_response: summarize(result),
          },
          { threadId: ctx.threadId },
        );
        return result;
      } catch (err) {
        await bus.emit(
          'PostToolUseFailure',
          {
            tool_name: toolName,
            tool_input: finalInput ?? {},
            error: err instanceof Error ? err.message : String(err),
          },
          { threadId: ctx.threadId },
        );
        throw err;
      }
    },
  };
}

function summarize(result: unknown): unknown {
  try {
    const s = JSON.stringify(result);
    if (s.length > 4000) return s.slice(0, 4000) + '…';
    return result;
  } catch {
    return String(result).slice(0, 400);
  }
}
