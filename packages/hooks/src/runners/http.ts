import type { HookHandler, HookHandlerResult } from '../schema.js';
import { normalizeHookJson } from './command.js';

export async function runHttpHook(
  handler: Extract<HookHandler, { type: 'http' }>,
  payload: Record<string, unknown>,
  timeoutSec: number,
): Promise<HookHandlerResult> {
  const started = Date.now();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(handler.headers ?? {}),
  };
  // Resolve $VAR in headers when listed in allowedEnvVars
  for (const [k, v] of Object.entries(headers)) {
    headers[k] = v.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, name: string) => {
      if (!(handler.allowedEnvVars ?? []).includes(name)) return '';
      return process.env[name] ?? '';
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (handler.timeout ?? timeoutSec) * 1000);
  try {
    const res = await fetch(handler.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        error: `HTTP ${res.status}`,
        durationMs: Date.now() - started,
        stdout: text.slice(0, 2000),
      };
    }
    if (!text.trim()) return { durationMs: Date.now() - started };
    try {
      return { ...normalizeHookJson(JSON.parse(text) as Record<string, unknown>), durationMs: Date.now() - started };
    } catch {
      return { durationMs: Date.now() - started, stdout: text.slice(0, 2000) };
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}
