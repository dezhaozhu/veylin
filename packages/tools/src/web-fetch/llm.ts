import { getDefaultModelConfigIfKeyed } from '@veylin/shared/node';
import { makeSecondaryModelPrompt } from './prompt';

export const MAX_MARKDOWN_LENGTH = 100_000;

/** Run the user's prompt against fetched markdown via a small flash model. */
export async function applyPromptToMarkdown(
  prompt: string,
  markdownContent: string,
  isPreapprovedDomain: boolean,
): Promise<string> {
  const truncated =
    markdownContent.length > MAX_MARKDOWN_LENGTH
      ? `${markdownContent.slice(0, MAX_MARKDOWN_LENGTH)}\n\n[Content truncated due to length...]`
      : markdownContent;

  const cfg = getDefaultModelConfigIfKeyed();
  if (!cfg) {
    return `[No API key for web_fetch secondary model; raw excerpt below]\n\n${truncated.slice(0, 4000)}`;
  }

  const userPrompt = makeSecondaryModelPrompt(truncated, prompt, isPreapprovedDomain);
  const res = await fetch(`${cfg.url}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.modelId,
      messages: [{ role: 'user', content: userPrompt.slice(0, 120_000) }],
      temperature: 0,
      max_tokens: 2048,
    }),
    signal: AbortSignal.timeout(Number(process.env.VEYLIN_WEB_FETCH_LLM_TIMEOUT_MS ?? 45_000)),
  });

  if (!res.ok) {
    throw new Error(`web_fetch secondary model failed: ${res.status}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return `[Secondary model returned empty; raw page excerpt below]\n\n${truncated.slice(0, 4000)}`;
  }
  return content;
}

// Re-export for callers that referenced DEFAULT_MODEL from this module.
export { DEFAULT_MODEL } from '@veylin/shared/node';
