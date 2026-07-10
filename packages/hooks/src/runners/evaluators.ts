import type { HookHandler, HookHandlerResult } from '../schema.js';
import { normalizeHookJson, parseHookStdout } from './command.js';

export type McpToolCaller = (input: {
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
}) => Promise<string>;

export type PromptEvaluator = (input: {
  prompt: string;
  payload: Record<string, unknown>;
  timeoutSec: number;
}) => Promise<HookHandlerResult>;

export type AgentEvaluator = (input: {
  prompt: string;
  subagentType?: string;
  payload: Record<string, unknown>;
  timeoutSec: number;
}) => Promise<HookHandlerResult>;

export async function runMcpToolHook(
  handler: Extract<HookHandler, { type: 'mcp_tool' }>,
  payload: Record<string, unknown>,
  callMcpTool: McpToolCaller | undefined,
  timeoutSec: number,
): Promise<HookHandlerResult> {
  const started = Date.now();
  if (!callMcpTool) {
    return { error: 'mcp_tool hook: no MCP caller configured', durationMs: Date.now() - started };
  }
  try {
    const text = await Promise.race([
      callMcpTool({
        server: handler.server,
        tool: handler.tool,
        arguments: { hook_event: payload },
      }),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('mcp_tool hook timeout')), (handler.timeout ?? timeoutSec) * 1000),
      ),
    ]);
    return { ...parseHookStdout(text, 0), durationMs: Date.now() - started, stdout: text };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

export async function runPromptHook(
  handler: Extract<HookHandler, { type: 'prompt' }>,
  payload: Record<string, unknown>,
  evaluate: PromptEvaluator | undefined,
): Promise<HookHandlerResult> {
  const started = Date.now();
  if (!evaluate) {
    return { error: 'prompt hook: no evaluator configured', durationMs: Date.now() - started };
  }
  try {
    const result = await evaluate({
      prompt: handler.prompt,
      payload,
      timeoutSec: handler.timeout ?? 30,
    });
    return { ...result, durationMs: Date.now() - started };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

export async function runAgentHook(
  handler: Extract<HookHandler, { type: 'agent' }>,
  payload: Record<string, unknown>,
  evaluate: AgentEvaluator | undefined,
): Promise<HookHandlerResult> {
  const started = Date.now();
  if (!evaluate) {
    return { error: 'agent hook: no evaluator configured', durationMs: Date.now() - started };
  }
  try {
    const result = await evaluate({
      prompt: handler.prompt,
      subagentType: handler.subagent_type,
      payload,
      timeoutSec: handler.timeout ?? 60,
    });
    return { ...result, durationMs: Date.now() - started };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

export { normalizeHookJson };
