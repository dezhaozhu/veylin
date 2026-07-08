import { getModelConfig, DEFAULT_MODEL, type ModelKey } from '@veylin/runtime';

const TITLE_MAX_LEN = 60;

export function truncateTitle(text: string, max = TITLE_MAX_LEN): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return 'New Chat';
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

type MessageLike = {
  role?: string;
  content?: { type?: string; text?: string }[];
  parts?: { type?: string; text?: string }[];
};

/** Extract first user message text from assistant-ui ThreadMessage[] or UI messages. */
export function firstUserText(messages: readonly unknown[]): string {
  for (const raw of messages) {
    const m = raw as MessageLike & { content?: string };
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string' && m.content.trim()) return m.content.trim();
    if (Array.isArray(m.content)) {
      const text = m.content.find((p) => p.type === 'text' && p.text)?.text;
      if (text?.trim()) return text.trim();
    }
    if (Array.isArray(m.parts)) {
      const text = m.parts.find((p) => p.type === 'text' && p.text)?.text;
      if (text?.trim()) return text.trim();
    }
  }
  return '';
}

/**
 * Generate a short conversation title (agent-style: Haiku/flash, ≤60 chars).
 * Falls back to truncating the first user message when the model is unavailable.
 */
export async function generateThreadTitle(
  messages: readonly unknown[],
  modelKey: ModelKey = DEFAULT_MODEL,
): Promise<string> {
  const prompt = firstUserText(messages);
  if (!prompt) return 'New Chat';

  const cfg = getModelConfig(modelKey);
  if (!cfg.apiKey) return truncateTitle(prompt);

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
          {
            role: 'system',
            content:
              'Generate a concise conversation title (max 60 characters) based on the user message. ' +
              'Return only the title text — no quotes, no punctuation wrapper, no explanation.',
          },
          { role: 'user', content: prompt.slice(0, 2000) },
        ],
        temperature: 0.2,
        max_tokens: 40,
      }),
    });
    if (!res.ok) return truncateTitle(prompt);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return truncateTitle(prompt);
    return truncateTitle(raw.replace(/^["']|["']$/g, ''));
  } catch {
    return truncateTitle(prompt);
  }
}
