import type { Memory } from '@mastra/memory';

type RecallArgs = Parameters<Memory['recall']>[0];
type RecallResult = Awaited<ReturnType<Memory['recall']>>;

/**
 * `Memory.recall` with thread-scoped memory (see packages/runtime/src/memory.ts)
 * validates that the thread exists in mastra storage and THROWS
 * "No thread found with id ..." for brand-new threads that have no persisted
 * messages yet. Every recall call site in this server treats "no history" as
 * an empty transcript, so surface that case as `{ messages: [] }` instead of
 * an exception (a fresh conversation must never 500 on load).
 */
export async function recallOrEmpty(memory: Memory, args: RecallArgs): Promise<RecallResult> {
  try {
    return await memory.recall(args);
  } catch (err) {
    if (err instanceof Error && /No thread found with id/i.test(err.message)) {
      return { messages: [] } as unknown as RecallResult;
    }
    throw err;
  }
}
