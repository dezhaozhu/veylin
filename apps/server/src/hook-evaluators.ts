import { getModelConfig } from '@veylin/runtime';
import type { PromptEvaluator, AgentEvaluator, HookHandlerResult } from '@veylin/hooks';
import { normalizeHookJson } from '@veylin/hooks';

/** Single-turn LLM yes/no (or JSON decision) for prompt hooks. */
export function createPromptHookEvaluator(): PromptEvaluator {
  return async ({ prompt, payload, timeoutSec }) => {
    const cfg = getModelConfig('default');
    if (!cfg.apiKey.trim()) {
      return { error: 'prompt hook: model API key not configured' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
    try {
      const res = await fetch(`${cfg.url.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: cfg.modelId,
          temperature: 0,
          max_tokens: 300,
          messages: [
            {
              role: 'system',
              content:
                'You are a Veylin hook evaluator. Reply with JSON only: ' +
                '{"decision":"allow"|"deny","reason":"..."} or {"continue":false,"reason":"..."}.',
            },
            {
              role: 'user',
              content: `Instruction: ${prompt}\n\nEvent payload: ${JSON.stringify(payload).slice(0, 6000)}`,
            },
          ],
        }),
      });
      if (!res.ok) {
        return { error: `prompt hook HTTP ${res.status}` };
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content?.trim() ?? '';
      try {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
          return normalizeHookJson(JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>);
        }
      } catch {
        /* fall through */
      }
      const lower = text.toLowerCase();
      if (lower.includes('deny') || lower.startsWith('no')) {
        return { decision: 'deny', reason: text.slice(0, 400) };
      }
      return { decision: 'allow', reason: text.slice(0, 400) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Lightweight agent-hook evaluator: same as prompt for now (no nested tools). */
export function createAgentHookEvaluator(): AgentEvaluator {
  const promptEval = createPromptHookEvaluator();
  return async (input) => {
    const result: HookHandlerResult = await promptEval({
      prompt: `[agent hook${input.subagentType ? `:${input.subagentType}` : ''}] ${input.prompt}`,
      payload: input.payload,
      timeoutSec: input.timeoutSec,
    });
    return result;
  };
}
