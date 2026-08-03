import type { HookBus } from '@veylin/hooks';
import { getEnterprisePorts } from './ports/index.js';

type AnyTool = {
  id?: string;
  execute?: (input: unknown, ctx?: unknown) => Promise<unknown> | unknown;
  [key: string]: unknown;
};

/**
 * After hook wrapping, also record business MCP tool calls via AuditPort.
 */
export function wrapToolsetsWithAudit(
  toolsets: Record<string, unknown>,
  ctx: { threadId?: string; tenantId: string; userId: string },
): Record<string, unknown> {
  const audit = getEnterprisePorts().audit;
  const out: Record<string, unknown> = {};
  for (const [group, tools] of Object.entries(toolsets)) {
    if (!tools || typeof tools !== 'object') {
      out[group] = tools;
      continue;
    }
    const wrapped: Record<string, unknown> = {};
    for (const [name, tool] of Object.entries(tools as Record<string, AnyTool>)) {
      wrapped[name] = wrapOne(tool, name, group, audit, ctx);
    }
    out[group] = wrapped;
  }
  return out;
}

function wrapOne(
  tool: AnyTool,
  name: string,
  group: string,
  audit: ReturnType<typeof getEnterprisePorts>['audit'],
  ctx: { threadId?: string; tenantId: string; userId: string },
): AnyTool {
  const original = tool?.execute;
  if (typeof original !== 'function') return tool;
  return {
    ...tool,
    execute: async (input: unknown, execCtx?: unknown) => {
      const toolName = String(tool.id ?? `mcp__${group}__${name}`);
      const started = Date.now();
      try {
        const result = await original.call(tool, input, execCtx);
        await audit.record({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          threadId: ctx.threadId,
          action: 'tool.call',
          detail: {
            tool: toolName,
            server: group,
            ok: true,
            durationMs: Date.now() - started,
            input: summarize(input),
          },
        });
        return result;
      } catch (err) {
        await audit.record({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          threadId: ctx.threadId,
          action: 'tool.call',
          detail: {
            tool: toolName,
            server: group,
            ok: false,
            durationMs: Date.now() - started,
            error: err instanceof Error ? err.message : String(err),
            input: summarize(input),
          },
        });
        throw err;
      }
    },
  };
}

function summarize(value: unknown): unknown {
  try {
    const s = JSON.stringify(value);
    if (s.length > 2000) return `${s.slice(0, 2000)}…`;
    return value;
  } catch {
    return String(value).slice(0, 200);
  }
}

/** Re-export type for callers that already use HookBus wraps. */
export type { HookBus };
