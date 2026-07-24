import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { DEFAULT_WORKING_MEMORY_TEMPLATE } from '@veylin/shared';
import { isEmbeddingModelReady } from '@veylin/db';
import { localFastembed } from './fastembed-local';

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Pure `options` builder, extracted from {@link buildMemory} so the thread-scope
 * regression test can lock the config down without spinning up LibSQL/the embedder.
 *
 * Both `semanticRecall.scope` and `workingMemory.scope` MUST be `'thread'`, never
 * `'resource'` — `'resource'` scope leaked cross-project data across every thread
 * that shares a resourceId:
 *  - workingMemory: via the null-fallback seed in `thread-state.syncWorkingMemory`
 *    / `dream-service` (`storedWorkingMemory ?? memory.getWorkingMemory(...)`) —
 *    a fresh thread with no working memory of its own would silently inherit
 *    whatever another thread on the same resource last wrote.
 *  - semanticRecall: via subagent/workflow `agent.generate({ memory })` calls,
 *    which auto-recall resource-scoped history. (Main chat's `/api/chat` was
 *    never affected — it doesn't pass `memory` into `agent.stream`, so it never
 *    triggered auto-recall keyed off `vectorSearchString`.)
 */
export function buildMemoryOptions({
  lastMessages,
  recallEnabled,
}: {
  lastMessages: number;
  recallEnabled: boolean;
}) {
  return {
    readOnly: true,
    lastMessages,
    semanticRecall: recallEnabled
      ? ({
          topK: 4,
          messageRange: { before: 2, after: 1 },
          scope: 'thread' as const,
        } as const)
      : (false as const),
    workingMemory: {
      enabled: true,
      scope: 'thread' as const,
      template: DEFAULT_WORKING_MEMORY_TEMPLATE,
    },
  };
}

/**
 * LibSQL file in app-data: thread/message storage + vector semantic recall.
 *
 * `readOnly: true` keeps working-memory available for explicit reads but does
 * not register `updateWorkingMemory` on agents that attach this Memory.
 * Writes go through `scheduleDreamConsolidation` / `syncWorkingMemory` /
 * explicit `saveMessages` and client `syncThreadMessagesFromClient`.
 *
 * Main chat (`/api/chat`) does **not** pass `memory` into `agent.stream`.
 * Mastra's SaveQueue / MessageHistory would otherwise append a new assistant
 * id every step without deleting prior snapshots. Chat injects WM via
 * `buildReadOnlyWorkingMemoryBlock` and recalls transcript before stream.
 */
export function buildMemory(libsqlUrl: string): Memory {
  const lastMessages = envInt('VEYLIN_COMPACT_KEEP', 12);
  const recallEnabled = isEmbeddingModelReady();
  return new Memory({
    storage: new LibSQLStore({ id: 'veylin-storage', url: libsqlUrl }),
    vector: new LibSQLVector({ id: 'veylin-vector', url: libsqlUrl }),
    ...(recallEnabled ? { embedder: localFastembed } : {}),
    options: buildMemoryOptions({ lastMessages, recallEnabled }),
  });
}
