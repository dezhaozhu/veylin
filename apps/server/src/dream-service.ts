import { getModelConfig, buildSummarizer } from '@veylin/runtime';
import type { Runtime } from '@veylin/runtime';
import { updateThreadState } from '@veylin/db';
import type { ThreadIdentity } from './message-sync';
import { getThreadState } from './thread-state';

const WM_TEMPLATE = `# Operator & Site Context
- Operator:
- Site / Line:
- Active Work Order:
- Constraints / Safety Notes:
- Open Decisions:
- Activated Skills:
`;

const DREAM_SYSTEM_PROMPT = [
  'You maintain a concise working-memory document for an ongoing agent conversation.',
  'Update the template sections with durable facts from the recent messages.',
  'Preserve the markdown structure and section headings. Be concise and factual.',
  'Store only cross-session context: operator/site, standing constraints, open decisions, preferences.',
  'Do NOT store transient task progress, tool output, code that can be re-read, or resolved one-off errors.',
  'Return ONLY the updated document — no commentary.',
].join('\n');

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DREAM_DEBOUNCE_MS = 8_000;
const MIN_MESSAGES = 6;

function partText(parts: unknown[] | undefined): string {
  if (!parts?.length) return '';
  const texts: string[] = [];
  for (const p of parts) {
    if (typeof p !== 'object' || p == null) continue;
    const part = p as { type?: string; text?: string };
    if (part.type === 'text') texts.push(part.text ?? '');
  }
  return texts.join('');
}

function formatTranscript(messages: unknown[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const role = (m as { role?: string }).role ?? 'user';
    const text = partText((m as { content?: { parts?: unknown[] } }).content?.parts);
    if (!text || text.includes('<task-notification>')) continue;
    lines.push(`${role}: ${text.slice(0, 1200)}`);
  }
  return lines.join('\n\n').slice(0, 12_000);
}

async function dreamSummarize(currentMemory: string, transcript: string): Promise<string | null> {
  const cfg = getModelConfig('deepseek');
  if (!cfg.apiKey) {
    const fallback = buildSummarizer('deepseek');
    if (!fallback) return null;
    return fallback(`Working memory:\n${currentMemory}\n\nConversation:\n${transcript}`);
  }

  const res = await fetch(`${cfg.url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.modelId,
      messages: [
        { role: 'system', content: DREAM_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Current working memory:\n${currentMemory}\n\nRecent conversation:\n${transcript}`,
        },
      ],
      temperature: 0,
      max_tokens: 600,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

export function scheduleDreamConsolidation(runtime: Runtime, identity: ThreadIdentity): void {
  if (process.env.VEYLIN_DREAM_DISABLED === '1') return;
  const key = identity.threadId;
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);
  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key);
      void runDreamConsolidation(runtime, identity).catch(() => undefined);
    }, DREAM_DEBOUNCE_MS),
  );
}

async function runDreamConsolidation(runtime: Runtime, identity: ThreadIdentity): Promise<void> {
  const recalled = await runtime.memory.recall({
    threadId: identity.threadId,
    resourceId: identity.resourceId,
    perPage: 30,
  });
  const messages = recalled.messages ?? [];
  if (messages.length < MIN_MESSAGES) return;

  const state = await getThreadState(identity.threadId);
  const currentMemory =
    state?.workingMemory ??
    (await runtime.memory.getWorkingMemory({
      threadId: identity.threadId,
      resourceId: identity.resourceId,
    })) ??
    WM_TEMPLATE;

  const transcript = formatTranscript(messages);
  if (!transcript.trim()) return;

  const updated = await dreamSummarize(currentMemory, transcript);
  if (!updated || updated === currentMemory) return;

  await runtime.memory.updateWorkingMemory({
    threadId: identity.threadId,
    resourceId: identity.resourceId,
    workingMemory: updated,
  });
  await updateThreadState(identity.threadId, { workingMemory: updated });
}
