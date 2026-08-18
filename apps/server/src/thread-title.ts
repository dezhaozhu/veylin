import { getModelConfig, DEFAULT_MODEL, type ModelKey } from '@veylin/runtime';

/** Sidebar width: ChatGPT / Cursor titles stay short. */
const TITLE_MAX_LEN = 40;
/** First user line this short is already the title — do not ask a model. */
const KEEP_USER_MAX = 32;

export function truncateTitle(text: string, max = TITLE_MAX_LEN): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return 'New Chat';
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

export function stripReasoningMarkup(text: string): string {
  return text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<think\b[^>]*>[\s\S]*$/gi, ' ')
    .replace(/<\/?think>/gi, ' ')
    .replace(/<analysis\b[^>]*>[\s\S]*?<\/analysis>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stored titles that must not stay in the sidebar (reasoning dump / meta). */
export function isUnusableTitle(title: string | null | undefined): boolean {
  const t = title?.trim() ?? '';
  if (!t) return true;
  if (/<\/?think\b/i.test(t)) return true;
  if (/^the user\b/i.test(t)) return true;
  if (/用户(的)?(消息|问题|说)/.test(t)) return true;
  return false;
}

export function titleFromUserMessage(prompt: string, max = TITLE_MAX_LEN): string {
  const firstLine =
    prompt
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean) ?? '';
  return truncateTitle(firstLine || prompt, max);
}

export function shouldSummarizeUserMessage(prompt: string): boolean {
  const firstLine =
    prompt
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean) ?? prompt.trim();
  if (prompt.includes('\n') && [...prompt.trim()].length > KEEP_USER_MAX) return true;
  return [...firstLine].length > KEEP_USER_MAX;
}

export function sanitizeGeneratedTitle(raw: string, fallback: string): string {
  let t = stripReasoningMarkup(raw);
  t = t.replace(/^["'「『]|["'」』]$/g, '').trim();
  t = t.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? '';
  if (!t || isUnusableTitle(t)) return fallback;
  return truncateTitle(t);
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
 * ChatGPT / Cursor title:
 *   short first user line → keep it
 *   long paste → optional model phrase, then sanitize
 *   never use assistant thinking
 */
export async function generateThreadTitle(
  messages: readonly unknown[],
  modelKey: ModelKey = DEFAULT_MODEL,
): Promise<string> {
  const prompt = firstUserText(messages);
  if (!prompt) return 'New Chat';

  const fallback = titleFromUserMessage(prompt);
  if (!shouldSummarizeUserMessage(prompt)) return fallback;

  const cfg = getModelConfig(modelKey);
  if (!cfg.apiKey) return fallback;

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
              'Create a short sidebar title for this chat, like ChatGPT or Cursor. ' +
              '2–8 words, or at most 16 Chinese characters. Same language as the user. ' +
              'Topic or noun phrase, not a sentence. ' +
              'Return only the title — no quotes, no thinking, no explanation.',
          },
          { role: 'user', content: prompt.slice(0, 2000) },
        ],
        temperature: 0.2,
        max_tokens: 32,
      }),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return fallback;
    return sanitizeGeneratedTitle(raw, fallback);
  } catch {
    return fallback;
  }
}
