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
 * LibSQL file in app-data: thread/message storage + vector semantic recall.
 *
 * `readOnly: true` keeps working-memory context in the prompt but does not
 * register `updateWorkingMemory` on the main agent loop (Claude Code–style:
 * no mid-turn WM tool → no forced follow-up think). Writes go through
 * `scheduleDreamConsolidation` / `syncWorkingMemory` / explicit `saveMessages`.
 */
export function buildMemory(libsqlUrl: string): Memory {
  const lastMessages = envInt('VEYLIN_COMPACT_KEEP', 12);
  const recallEnabled = isEmbeddingModelReady();
  return new Memory({
    storage: new LibSQLStore({ id: 'veylin-storage', url: libsqlUrl }),
    vector: new LibSQLVector({ id: 'veylin-vector', url: libsqlUrl }),
    ...(recallEnabled ? { embedder: localFastembed } : {}),
    options: {
      readOnly: true,
      lastMessages,
      semanticRecall: recallEnabled
        ? {
            topK: 4,
            messageRange: { before: 2, after: 1 },
            scope: 'resource',
          }
        : false,
      workingMemory: {
        enabled: true,
        scope: 'resource',
        template: DEFAULT_WORKING_MEMORY_TEMPLATE,
      },
    },
  });
}
