import { randomUUID } from 'node:crypto';
import { ifConditionMatches, matcherMatches, matchValueForEvent } from './matcher.js';
import type {
  HookEmitResult,
  HookEvent,
  HookHandlerResult,
  HookLogEntry,
  LoadedHookHandler,
} from './schema.js';
import { DORMANT_HOOK_EVENTS } from './schema.js';
import { runCommandHook } from './runners/command.js';
import { runHttpHook } from './runners/http.js';
import {
  runAgentHook,
  runMcpToolHook,
  runPromptHook,
  type AgentEvaluator,
  type McpToolCaller,
  type PromptEvaluator,
} from './runners/evaluators.js';

export interface HookBusOptions {
  workspaceRoot?: string | null;
  dataDir?: string;
  failClosedOnTimeout?: boolean;
  callMcpTool?: McpToolCaller;
  evaluatePrompt?: PromptEvaluator;
  evaluateAgent?: AgentEvaluator;
  onAsyncRewake?: (info: { stderr: string; event: HookEvent; threadId?: string }) => void;
  maxLogEntries?: number;
}

export class HookBus {
  private handlers: LoadedHookHandler[] = [];
  private onceConsumed = new Set<string>();
  private logs: HookLogEntry[] = [];
  private opts: HookBusOptions;

  constructor(opts: HookBusOptions = {}) {
    this.opts = opts;
  }

  setHandlers(handlers: LoadedHookHandler[]): void {
    this.handlers = handlers;
  }

  getHandlers(): LoadedHookHandler[] {
    return this.handlers;
  }

  getLogs(limit = 50): HookLogEntry[] {
    return this.logs.slice(0, limit);
  }

  updateOptions(patch: Partial<HookBusOptions>): void {
    this.opts = { ...this.opts, ...patch };
  }

  async emit(
    event: HookEvent,
    payload: Record<string, unknown>,
    ctx: { threadId?: string; pluginEnv?: Record<string, string> } = {},
  ): Promise<HookEmitResult> {
    const matchValue = matchValueForEvent(event, payload);
    const candidates = this.handlers.filter((h) => {
      if (h.event !== event || !h.enabled) return false;
      if (!matcherMatches(h.matcher, matchValue)) return false;
      if (!ifConditionMatches(event, h.handler.if, payload)) return false;
      const onceKey = `${event}:${h.source}:${h.sourceId ?? ''}:${JSON.stringify(h.handler)}`;
      if (h.handler.once) {
        if (this.onceConsumed.has(onceKey)) return false;
      }
      return true;
    });

    if (candidates.length === 0) {
      return {
        decision: 'allow',
        additionalContext: '',
        results: [],
        dormant: DORMANT_HOOK_EVENTS.has(event),
      };
    }

    if (DORMANT_HOOK_EVENTS.has(event)) {
      for (const c of candidates) {
        this.pushLog({
          id: randomUUID(),
          at: new Date().toISOString(),
          event,
          matcher: c.matcher,
          source: c.source,
          sourceId: c.sourceId,
          dormant: true,
          error: 'event substrate not available (dormant)',
        });
      }
      return {
        decision: 'allow',
        additionalContext: '',
        results: [],
        dormant: true,
        unsupported: true,
      };
    }

    const syncHandlers = candidates.filter((h) => !isAsyncHandler(h));
    const asyncHandlers = candidates.filter((h) => isAsyncHandler(h));

    for (const h of asyncHandlers) {
      void this.runOne(h, payload, ctx).then((result) => {
        this.record(h, result);
        if (
          h.handler.type === 'command' &&
          h.handler.asyncRewake &&
          result.exitCode === 2 &&
          this.opts.onAsyncRewake
        ) {
          this.opts.onAsyncRewake({
            stderr: result.stderr || result.stdout || 'asyncRewake exit 2',
            event,
            threadId: ctx.threadId,
          });
        }
      });
    }

    const results = await Promise.all(syncHandlers.map((h) => this.runOne(h, payload, ctx)));
    for (let i = 0; i < syncHandlers.length; i++) {
      const h = syncHandlers[i]!;
      const result = results[i]!;
      this.record(h, result);
      if (h.handler.once) {
        const onceKey = `${event}:${h.source}:${h.sourceId ?? ''}:${JSON.stringify(h.handler)}`;
        this.onceConsumed.add(onceKey);
      }
    }

    return mergeResults(results, this.opts.failClosedOnTimeout === true);
  }

  private async runOne(
    loaded: LoadedHookHandler,
    payload: Record<string, unknown>,
    ctx: { threadId?: string; pluginEnv?: Record<string, string> },
  ): Promise<HookHandlerResult> {
    const handler = loaded.handler;
    const defaultTimeout =
      loaded.event === 'MessageDisplay' ? 10 : loaded.event === 'UserPromptSubmit' ? 30 : 60;
    const cwd =
      this.opts.workspaceRoot ||
      loaded.pluginRoot ||
      this.opts.dataDir ||
      process.cwd();
    const env: Record<string, string> = {
      VEYLIN_PROJECT_DIR: this.opts.workspaceRoot ?? cwd,
      VEYLIN_PLUGIN_ROOT: loaded.pluginRoot ?? '',
      ...(ctx.pluginEnv ?? {}),
    };

    try {
      switch (handler.type) {
        case 'command':
          return await runCommandHook(handler, {
            payload: { ...payload, hook_event_name: loaded.event },
            cwd,
            env,
            timeoutSec: handler.timeout ?? defaultTimeout,
          });
        case 'http':
          return await runHttpHook(
            handler,
            { ...payload, hook_event_name: loaded.event },
            handler.timeout ?? defaultTimeout,
          );
        case 'mcp_tool':
          return await runMcpToolHook(
            handler,
            { ...payload, hook_event_name: loaded.event },
            this.opts.callMcpTool,
            handler.timeout ?? defaultTimeout,
          );
        case 'prompt':
          return await runPromptHook(
            handler,
            { ...payload, hook_event_name: loaded.event },
            this.opts.evaluatePrompt,
          );
        case 'agent':
          return await runAgentHook(
            handler,
            { ...payload, hook_event_name: loaded.event },
            this.opts.evaluateAgent,
          );
        default:
          return { error: 'unknown handler type' };
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  private record(h: LoadedHookHandler, result: HookHandlerResult): void {
    this.pushLog({
      id: randomUUID(),
      at: new Date().toISOString(),
      event: h.event,
      matcher: h.matcher,
      source: h.source,
      sourceId: h.sourceId,
      decision: result.decision,
      durationMs: result.durationMs,
      error: result.error,
      stderr: result.stderr?.slice(0, 500),
    });
  }

  private pushLog(entry: HookLogEntry): void {
    this.logs.unshift(entry);
    const max = this.opts.maxLogEntries ?? 200;
    if (this.logs.length > max) this.logs.length = max;
  }
}

function isAsyncHandler(h: LoadedHookHandler): boolean {
  return (
    (h.handler.type === 'command' && (h.handler.async === true || h.handler.asyncRewake === true)) ||
    (h.handler.type === 'http' && h.handler.async === true) ||
    (h.handler.type === 'mcp_tool' && h.handler.async === true)
  );
}

function mergeResults(results: HookHandlerResult[], failClosedOnTimeout: boolean): HookEmitResult {
  let decision: HookEmitResult['decision'] = 'allow';
  let reason: string | undefined;
  let retry: boolean | undefined;
  let updatedInput: Record<string, unknown> | undefined;
  const contexts: string[] = [];

  for (const r of results) {
    if (r.error?.includes('timeout') && failClosedOnTimeout) {
      decision = 'deny';
      reason = r.error;
    }
    if (r.decision === 'deny') {
      decision = 'deny';
      reason = r.reason ?? reason;
    } else if (r.decision === 'ask' && decision === 'allow') {
      decision = 'ask';
      reason = r.reason ?? reason;
    }
    if (r.additionalContext) contexts.push(r.additionalContext);
    if (r.updatedInput) updatedInput = { ...updatedInput, ...r.updatedInput };
    if (r.retry) retry = true;
  }

  return {
    decision,
    reason,
    additionalContext: contexts.filter(Boolean).join('\n\n'),
    updatedInput,
    retry,
    results,
  };
}
