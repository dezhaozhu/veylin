import { DEFAULT_MODEL, getModelConfig } from '@veylin/runtime';
import { makeSecondaryModelPrompt } from './prompt';

export const MAX_MARKDOWN_LENGTH = 100_000;

type ModelCfg = { url: string; modelId: string; apiKey: string };

function webFetchModelConfig(): ModelCfg | undefined {
  const cfg = getModelConfig(DEFAULT_MODEL);
  const apiKey = cfg.apiKey.trim();
  if (!apiKey) return undefined;
  return {
    url: cfg.url.replace(/\/$/, ''),
    modelId: cfg.modelId,
    apiKey,
  };
}

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

  const cfg = webFetchModelConfig();
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
      messages: [
        {
          role: 'system',
          content:
            'You extract and summarize web page content per the user prompt. Be concise and factual.',
        },
        { role: 'user', content: userPrompt.slice(0, 120_000) },
      ],
      temperature: 0,
      max_tokens: 2048,
    }),
    signal: AbortSignal.timeout(Number(process.env.VEYLIN_WEB_FETCH_LLM_TIMEOUT_MS ?? 45_000)),
  });

  if (!res.ok) {
    throw new Error(`web_fetch secondary model failed: ${res.status}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? 'No response from model';
}
