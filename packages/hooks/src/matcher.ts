import type { HookEvent } from './schema.js';
import { TOOL_HOOK_EVENTS } from './schema.js';

/**
 * Claude-compatible matcher:
 * - omitted / "" / "*" → match all
 * - only [A-Za-z0-9_\\- ,|] → exact alternatives split by | or ,
 * - otherwise → unanchored RegExp
 */
export function matcherMatches(matcher: string | undefined, value: string): boolean {
  if (matcher == null || matcher === '' || matcher === '*') return true;
  const exactSafe = /^[A-Za-z0-9_\- ,|]+$/.test(matcher);
  if (exactSafe) {
    const parts = matcher
      .split(/[|,]/)
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.includes(value);
  }
  try {
    return new RegExp(matcher).test(value);
  } catch {
    return false;
  }
}

/**
 * Best-effort `if` filter for tool events, e.g. `Bash(rm *)` or `bash(git *)`.
 * Non-tool events: if `if` is set, the handler never runs (Claude semantics).
 */
export function ifConditionMatches(
  event: HookEvent,
  ifRule: string | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!ifRule) return true;
  if (!TOOL_HOOK_EVENTS.has(event)) return false;

  const m = ifRule.match(/^([A-Za-z0-9_\-]+)\((.*)\)$/);
  if (!m) return true; // fail open when unparseable
  const toolName = m[1]!;
  const pattern = m[2] ?? '*';
  const actualTool = String(payload.tool_name ?? payload.toolName ?? '');
  if (actualTool && actualTool.toLowerCase() !== toolName.toLowerCase()) {
    // Allow mcp__server__tool style when rule uses the short name — fail open on mismatch of casing only
    if (!actualTool.toLowerCase().includes(toolName.toLowerCase())) return false;
  }

  const input = (payload.tool_input ?? payload.toolInput ?? {}) as Record<string, unknown>;
  const command = String(input.command ?? input.path ?? JSON.stringify(input));
  return globishMatch(pattern, command);
}

function globishMatch(pattern: string, text: string): boolean {
  if (pattern === '*' || pattern === '') return true;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  try {
    return new RegExp(`^${escaped}$`, 'i').test(text) || new RegExp(escaped, 'i').test(text);
  } catch {
    return true;
  }
}

export function matchValueForEvent(event: HookEvent, payload: Record<string, unknown>): string {
  switch (event) {
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionRequest':
    case 'PermissionDenied':
      return String(payload.tool_name ?? payload.toolName ?? '');
    case 'SessionStart':
      return String(payload.source ?? payload.reason ?? 'startup');
    case 'SessionEnd':
      return String(payload.reason ?? 'other');
    case 'Setup':
      return String(payload.trigger ?? 'init');
    case 'SubagentStart':
    case 'SubagentStop':
      return String(payload.agent_type ?? payload.subagent_type ?? payload.agentType ?? '');
    case 'PreCompact':
    case 'PostCompact':
      return String(payload.trigger ?? 'auto');
    case 'StopFailure':
      return String(payload.error_type ?? payload.errorType ?? 'unknown');
    case 'Notification':
      return String(payload.notification_type ?? payload.type ?? '');
    case 'ConfigChange':
      return String(payload.source ?? '');
    case 'InstructionsLoaded':
      return String(payload.reason ?? 'session_start');
    case 'UserPromptExpansion':
      return String(payload.command ?? payload.skill ?? '');
    case 'Elicitation':
    case 'ElicitationResult':
      return String(payload.server ?? payload.mcp_server ?? '');
    case 'FileChanged':
      return String(payload.filename ?? payload.path ?? '');
    case 'SkillActivated':
      return String(payload.name ?? payload.skill ?? '');
    default:
      return '';
  }
}
