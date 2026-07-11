import { getModelConfig, DEFAULT_MODEL, type ModelKey } from '@veylin/runtime';

export type GoalEvalResult = {
  done: boolean;
  reason: string;
};

/**
 * Independent Claude-style goal evaluator: judges condition against transcript only.
 * Does not run tools or read the filesystem.
 */
export async function evaluateGoalCondition(opts: {
  condition: string;
  transcriptSummary: string;
  modelKey?: ModelKey;
}): Promise<GoalEvalResult> {
  const cfg = getModelConfig(opts.modelKey ?? DEFAULT_MODEL);
  if (!cfg.apiKey) {
    return {
      done: false,
      reason: 'Evaluator unavailable (no API key); keep working and leave evidence in the transcript.',
    };
  }

  const system = [
    'You are an independent goal evaluator for a coding agent.',
    'Decide whether the completion CONDITION is satisfied based ONLY on the transcript evidence.',
    'Do not assume work was done unless the transcript shows it.',
    'Reply with JSON only: {"done":boolean,"reason":"short explanation"}',
  ].join(' ');

  const user = [
    `CONDITION:\n${opts.condition}`,
    '',
    `TRANSCRIPT EVIDENCE:\n${opts.transcriptSummary.slice(0, 24_000)}`,
  ].join('\n');

  try {
    const res = await fetch(`${cfg.url.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.modelId,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      return {
        done: false,
        reason: `Evaluator HTTP ${res.status}; continue working.`,
      };
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
    const parsed = JSON.parse(raw) as { done?: unknown; reason?: unknown };
    return {
      done: Boolean(parsed.done),
      reason:
        typeof parsed.reason === 'string' && parsed.reason.trim()
          ? parsed.reason.trim()
          : parsed.done
            ? 'Condition met.'
            : 'Condition not yet met.',
    };
  } catch (err) {
    return {
      done: false,
      reason: `Evaluator error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Build a compact transcript for the evaluator from UI-like messages. */
export function summarizeMessagesForGoalEval(
  messages: Array<{ role?: string; content?: unknown; parts?: unknown[] }>,
  maxChars = 20_000,
): string {
  const chunks: string[] = [];
  for (const m of messages.slice(-40)) {
    const role = m.role ?? 'unknown';
    let text = '';
    if (typeof m.content === 'string') text = m.content;
    else if (Array.isArray(m.parts)) {
      text = m.parts
        .map((p) => {
          const part = p as { type?: string; text?: string; output?: unknown; toolName?: string };
          if (part.type === 'text' && part.text) return part.text;
          if (part.type?.startsWith('tool-') || part.toolName) {
            const out =
              typeof part.output === 'string'
                ? part.output
                : part.output != null
                  ? JSON.stringify(part.output).slice(0, 800)
                  : '';
            return `[tool ${part.toolName ?? part.type}] ${out}`;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    if (!text.trim()) continue;
    chunks.push(`${role.toUpperCase()}: ${text.trim()}`);
  }
  const joined = chunks.join('\n\n');
  return joined.length > maxChars ? joined.slice(-maxChars) : joined;
}
