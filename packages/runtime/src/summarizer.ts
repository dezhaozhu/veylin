import { getModelConfig, type ModelKey } from './models';
import type { Summarizer } from './processors/contextCompression';

/**
 * Structured compaction prompt, modelled after the agent's sectioned summary
 * (instead of a single paragraph). The summary becomes the agent's only memory
 * of the compacted span, so it must preserve everything needed to continue.
 */
export const COMPACTION_SYSTEM_PROMPT = [
  'You are compacting an earlier span of an ongoing agent conversation so the agent can keep',
  'working without the full history. The summary REPLACES those messages — capture everything',
  'needed to continue correctly and lose nothing load-bearing.',
  '',
  'Output these sections (omit a section only if truly empty). Be concise and factual; no',
  'pleasantries, no meta commentary.',
  '',
  '## Primary request & intent',
  "What the user is ultimately trying to achieve, including explicit constraints and preferences.",
  '## Key facts & decisions',
  'Concrete facts established, choices made, and conventions agreed on (with the reasoning).',
  '## Files & data touched',
  'Files, paths, schedule sheets/rows, or other artifacts read or modified, with their role.',
  '## Errors & fixes',
  'Problems hit and how they were resolved (or that they are still open).',
  '## Open questions',
  'Unresolved questions or pending user decisions.',
  '## Pending todos',
  'Outstanding checklist items and their status.',
  '## Current work & next step',
  'What was happening right before this summary and the immediate next action.',
].join('\n');

/**
 * Build an LLM summarizer hitting the OpenAI-compatible endpoint directly (no
 * extra Agent instance). Used as the second compaction tier. Returns undefined
 * when the model has no API key so compaction silently falls back to the
 * deterministic tier.
 */
export function buildSummarizer(modelKey: ModelKey = 'deepseek'): Summarizer | undefined {
  const cfg = getModelConfig(modelKey);
  if (!cfg.apiKey) return undefined;

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
          {
            role: 'system',
            content: COMPACTION_SYSTEM_PROMPT,
          },
          { role: 'user', content: transcript.slice(0, 12000) },
        ],
        temperature: 0,
        max_tokens: 700,
      }),
    });
    if (!res.ok) throw new Error(`summarizer failed: ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() ?? '';
  };
}
