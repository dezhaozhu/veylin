import { recallOrEmpty } from './memory-recall.js';
import type { Memory } from '@mastra/memory';
import { forkWorkerEnvelope } from '@veylin/runtime';

const FORK_PLACEHOLDER = '[fork context carried in thread history]';

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

/** Skip task-notification injections when cloning parent history for a fork. */
function shouldCopyMessage(text: string): boolean {
  if (text.includes('<task-notification>')) return false;
  if (text.startsWith('[subagent:')) return false;
  return true;
}

/**
 * Clone parent thread messages into an isolated worker thread, then append the fork directive.
 * Mirrors Claude Code fork context inheritance (without cross-request prompt-cache sharing).
 */
export async function seedForkWorkerThread(options: {
  memory: Memory;
  parentThreadId: string;
  parentResource: string;
  workerThreadId: string;
  forkName: string;
  directive: string;
  maxMessages?: number;
}): Promise<string> {
  const recalled = await recallOrEmpty(options.memory, {
    threadId: options.parentThreadId,
    resourceId: options.parentResource,
    perPage: false,
  });
  let source = recalled.messages ?? [];
  const max = options.maxMessages ?? Number(process.env.VEYLIN_FORK_MAX_MESSAGES ?? 48);
  if (source.length > max) source = source.slice(-max);

  const copied: Array<Record<string, unknown>> = [];
  let i = 0;
  for (const m of source) {
    const text = partText((m as { content?: { parts?: unknown[] } }).content?.parts);
    if (text && !shouldCopyMessage(text)) continue;
    copied.push({
      id: crypto.randomUUID(),
      role: (m as { role?: string }).role ?? 'user',
      createdAt: new Date(Date.now() + i++),
      threadId: options.workerThreadId,
      resourceId: options.parentResource,
      content: (m as { content?: unknown }).content ?? { format: 2, parts: [{ type: 'text', text: FORK_PLACEHOLDER }] },
    });
  }

  const envelope = forkWorkerEnvelope(options.forkName, options.directive);
  copied.push({
    id: crypto.randomUUID(),
    role: 'user',
    createdAt: new Date(Date.now() + i),
    threadId: options.workerThreadId,
    resourceId: options.parentResource,
    content: { format: 2, parts: [{ type: 'text', text: envelope }] },
  });

  if (copied.length > 0) {
    await options.memory.saveMessages({ messages: copied as never });
  }
  return envelope;
}
