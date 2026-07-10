import { z } from 'zod';

/** Claude Code–compatible hook events + Veylin SkillActivated. */
export const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'Setup',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'PreToolUse',
  'PermissionRequest',
  'PermissionDenied',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Notification',
  'MessageDisplay',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
  'Stop',
  'StopFailure',
  'TeammateIdle',
  'InstructionsLoaded',
  'ConfigChange',
  'CwdChanged',
  'FileChanged',
  'WorktreeCreate',
  'WorktreeRemove',
  'PreCompact',
  'PostCompact',
  'Elicitation',
  'ElicitationResult',
  'SkillActivated',
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export const hookEventSchema = z.enum(HOOK_EVENTS);

/** Events that are schema-complete but may lack a live Veylin substrate. */
export const DORMANT_HOOK_EVENTS = new Set<HookEvent>([
  'Setup',
  'CwdChanged',
  'FileChanged',
  'WorktreeCreate',
  'WorktreeRemove',
  'TeammateIdle',
]);

export const LIVE_HOOK_EVENTS = new Set<HookEvent>(
  HOOK_EVENTS.filter((e) => !DORMANT_HOOK_EVENTS.has(e)),
);

export const TOOL_HOOK_EVENTS = new Set<HookEvent>([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
]);

const commandHandlerSchema = z.object({
  type: z.literal('command'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  shell: z.enum(['bash', 'powershell']).optional(),
  async: z.boolean().optional(),
  asyncRewake: z.boolean().optional(),
  if: z.string().optional(),
  timeout: z.number().positive().optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
});

const httpHandlerSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  allowedEnvVars: z.array(z.string()).optional(),
  if: z.string().optional(),
  timeout: z.number().positive().optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
  async: z.boolean().optional(),
});

const mcpToolHandlerSchema = z.object({
  type: z.literal('mcp_tool'),
  server: z.string().min(1),
  tool: z.string().min(1),
  if: z.string().optional(),
  timeout: z.number().positive().optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
  async: z.boolean().optional(),
});

const promptHandlerSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string().min(1),
  if: z.string().optional(),
  timeout: z.number().positive().optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
});

const agentHandlerSchema = z.object({
  type: z.literal('agent'),
  prompt: z.string().min(1),
  subagent_type: z.string().optional(),
  if: z.string().optional(),
  timeout: z.number().positive().optional(),
  statusMessage: z.string().optional(),
  once: z.boolean().optional(),
});

export const hookHandlerSchema = z.discriminatedUnion('type', [
  commandHandlerSchema,
  httpHandlerSchema,
  mcpToolHandlerSchema,
  promptHandlerSchema,
  agentHandlerSchema,
]);

export type HookHandler = z.infer<typeof hookHandlerSchema>;

export const hookMatcherGroupSchema = z.object({
  matcher: z.string().optional(),
  hooks: z.array(hookHandlerSchema).min(1),
});

export type HookMatcherGroup = z.infer<typeof hookMatcherGroupSchema>;

export type HooksConfig = Partial<Record<HookEvent, HookMatcherGroup[]>>;

export const hooksConfigSchema = z.record(hookEventSchema, z.array(hookMatcherGroupSchema));

/** Accept either `{ hooks: { Event: [...] } }` or a bare event map. */
export function parseHooksFile(raw: unknown): HooksConfig {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const inner = obj.hooks && typeof obj.hooks === 'object' ? obj.hooks : obj;
  const out: HooksConfig = {};
  for (const [key, value] of Object.entries(inner as Record<string, unknown>)) {
    if (!HOOK_EVENTS.includes(key as HookEvent)) continue;
    const parsed = z.array(hookMatcherGroupSchema).safeParse(value);
    if (parsed.success && parsed.data.length > 0) {
      out[key as HookEvent] = parsed.data;
    }
  }
  return out;
}

export type HookDecision = 'allow' | 'deny' | 'ask' | 'block' | undefined;

export interface HookSpecificOutput {
  hookEventName?: string;
  permissionDecision?: 'allow' | 'deny' | 'ask';
  permissionDecisionReason?: string;
  additionalContext?: string;
  updatedInput?: Record<string, unknown>;
  retry?: boolean;
}

export interface HookHandlerResult {
  decision?: HookDecision;
  reason?: string;
  additionalContext?: string;
  updatedInput?: Record<string, unknown>;
  retry?: boolean;
  hookSpecificOutput?: HookSpecificOutput;
  /** Non-blocking error message for logs. */
  error?: string;
  /** Exit code for command hooks. */
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  async?: boolean;
}

export interface HookEmitResult {
  decision: 'allow' | 'deny' | 'ask';
  reason?: string;
  additionalContext: string;
  updatedInput?: Record<string, unknown>;
  retry?: boolean;
  results: HookHandlerResult[];
  dormant?: boolean;
  unsupported?: boolean;
}

export type HookSource =
  | 'managed'
  | 'user'
  | 'project'
  | 'project_local'
  | 'plugin'
  | 'claude_compat'
  | 'skill'
  | 'frontmatter';

export interface LoadedHookHandler {
  event: HookEvent;
  matcher?: string;
  handler: HookHandler;
  source: HookSource;
  sourceId?: string;
  pluginRoot?: string;
  /** Absolute path of the hooks.json that declared this handler. */
  configPath?: string;
  enabled: boolean;
  dormant: boolean;
}

export interface HookLogEntry {
  id: string;
  at: string;
  event: HookEvent;
  matcher?: string;
  source: HookSource;
  sourceId?: string;
  decision?: string;
  durationMs?: number;
  error?: string;
  stderr?: string;
  dormant?: boolean;
}
