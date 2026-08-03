import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import type { HookHandler, HookHandlerResult } from '../schema.js';

export interface CommandRunnerContext {
  payload: Record<string, unknown>;
  cwd: string;
  env: Record<string, string>;
  timeoutSec: number;
}

function substitute(
  text: string,
  vars: Record<string, string>,
): string {
  let out = text;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`\${${key}}`).join(value).split(`$${key}`).join(value);
  }
  return out;
}

export async function runCommandHook(
  handler: Extract<HookHandler, { type: 'command' }>,
  ctx: CommandRunnerContext,
): Promise<HookHandlerResult> {
  const started = Date.now();
  const vars = {
    VEYLIN_PROJECT_DIR: ctx.env.VEYLIN_PROJECT_DIR ?? ctx.cwd,
    VEYLIN_PLUGIN_ROOT: ctx.env.VEYLIN_PLUGIN_ROOT ?? '',
    CLAUDE_PROJECT_DIR: ctx.env.VEYLIN_PROJECT_DIR ?? ctx.cwd,
    CLAUDE_PLUGIN_ROOT: ctx.env.VEYLIN_PLUGIN_ROOT ?? '',
    ...ctx.env,
  };

  const command = substitute(handler.command, vars);
  const args = (handler.args ?? []).map((a) => substitute(a, vars));
  const timeoutMs = (handler.timeout ?? ctx.timeoutSec) * 1000;

  const useExec = Array.isArray(handler.args);
  const isWin = platform() === 'win32';
  const shell = handler.shell ?? (isWin ? 'powershell' : 'bash');

  return new Promise((resolve) => {
    let child;
    try {
      if (useExec) {
        child = spawn(command, args, {
          cwd: ctx.cwd,
          env: { ...process.env, ...vars },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else if (shell === 'powershell') {
        child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
          cwd: ctx.cwd,
          env: { ...process.env, ...vars },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        child = spawn('bash', ['-lc', command], {
          cwd: ctx.cwd,
          env: { ...process.env, ...vars },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }
    } catch (err) {
      resolve({
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.stdin?.write(JSON.stringify(ctx.payload));
    child.stdin?.end();

    child.on('close', (code) => {
      clearTimeout(timer);
      const result = parseHookStdout(stdout, code ?? 1);
      resolve({
        ...result,
        exitCode: code ?? 1,
        stdout,
        stderr: stderr.trim() || undefined,
        durationMs: Date.now() - started,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        error: err.message,
        durationMs: Date.now() - started,
      });
    });
  });
}

export function parseHookStdout(stdout: string, exitCode: number): HookHandlerResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    // exit 2 historically means block in Claude hooks
    if (exitCode === 2) {
      return { decision: 'deny', reason: 'hook exit code 2' };
    }
    return {};
  }
  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    return normalizeHookJson(json);
  } catch {
    // try last JSON line
    const lines = trimmed.split('\n').reverse();
    for (const line of lines) {
      try {
        return normalizeHookJson(JSON.parse(line) as Record<string, unknown>);
      } catch {
        /* continue */
      }
    }
    if (exitCode === 2) return { decision: 'deny', reason: trimmed.slice(0, 500) };
    return {};
  }
}

export function normalizeHookJson(json: Record<string, unknown>): HookHandlerResult {
  const specific = json.hookSpecificOutput as Record<string, unknown> | undefined;
  const decisionRaw =
    (json.decision as string | undefined) ??
    (specific?.permissionDecision as string | undefined);
  const reason =
    (json.reason as string | undefined) ??
    (specific?.permissionDecisionReason as string | undefined);
  const additionalContext =
    (json.additionalContext as string | undefined) ??
    (specific?.additionalContext as string | undefined);
  const updatedInput =
    (json.updatedInput as Record<string, unknown> | undefined) ??
    (specific?.updatedInput as Record<string, unknown> | undefined);
  const retry =
    (json.retry as boolean | undefined) ?? (specific?.retry as boolean | undefined);

  // Claude also uses continue:false / block
  if (json.continue === false || decisionRaw === 'block') {
    return {
      decision: 'deny',
      reason: reason ?? 'blocked by hook',
      additionalContext,
      updatedInput,
      retry,
      hookSpecificOutput: specific as HookHandlerResult['hookSpecificOutput'],
    };
  }

  const decision =
    decisionRaw === 'allow' || decisionRaw === 'deny' || decisionRaw === 'ask'
      ? decisionRaw
      : undefined;

  return {
    decision,
    reason,
    additionalContext,
    updatedInput,
    retry,
    hookSpecificOutput: specific as HookHandlerResult['hookSpecificOutput'],
  };
}
