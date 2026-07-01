import { getModelConfig, DEFAULT_MODEL, type ModelKey } from './models';
import type { Summarizer } from './processors/contextCompression';

/**
 * Structured compaction prompt for replacing earlier conversation spans.
 * Sections align with agentic CLI compaction patterns (domain-neutral wording).
 */
export const COMPACTION_SYSTEM_PROMPT = [
  'You are compacting an earlier span of an ongoing agent conversation so the agent can keep',
  'working without the full history. The summary REPLACES those messages — capture everything',
  'needed to continue correctly and lose nothing load-bearing.',
  '',
  'Optional: wrap your reasoning in <analysis>...</analysis> before the final summary.',
  'Only the content OUTSIDE <analysis> tags will be kept in context.',
  '',
  'Output these sections (omit only if truly empty). Be concise and factual.',
  '',
  '## Primary request & intent',
  "The user's core requests, success criteria, constraints, and preferences.",
  '## Key facts & decisions',
  'Concrete facts, choices made, and conventions agreed on (with reasoning).',
  '## Artifacts & data touched',
  'Documents, table rows, URLs, or other artifacts read or modified.',
  '## Errors & fixes',
  'Problems encountered and how they were resolved (or that they remain open).',
  '## All user messages',
  'List every user message that is not a tool result — verbatim or near-verbatim when short.',
  '## Open questions',
  'Unresolved questions or pending user decisions.',
  '## Pending todos',
  'Outstanding checklist items and their status.',
  '## Current work & next step',
  'What was in progress immediately before compaction. If there is a next step, quote the',
  "user's most recent relevant request so task interpretation cannot drift.",
].join('\n');

/** Strip optional <analysis> draft block before injecting summary into context. */
export function formatCompactSummary(raw: string): string {
  return raw.replace(/<analysis>[\s\S]*?<\/analysis>\s*/gi, '').trim();
}

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Build an LLM summarizer hitting the OpenAI-compatible endpoint directly.
 * Returns undefined when the model has no API key (falls back to deterministic tier).
 */
export function buildSummarizer(modelKey: ModelKey = DEFAULT_MODEL): Summarizer | undefined {
  const cfg = getModelConfig(modelKey);
  if (!cfg.apiKey) return undefined;

  const maxTokens = envInt('VEYLIN_COMPACT_MAX_TOKENS', 2000);

  return async (transcript: string): Promise<string> => {
    const res = await fetch(`${cfg.url.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.modelId,
        messages: [
          { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
          { role: 'user', content: transcript.slice(0, 12000) },
        ],
        temperature: 0,
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) throw new Error(`summarizer failed: ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
    return formatCompactSummary(raw);
  };
}
