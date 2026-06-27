import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { fastembed } from '@mastra/fastembed';
import { DEFAULT_WORKING_MEMORY_TEMPLATE } from '@veylin/shared';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function isFastembedInstalled(): boolean {
  return existsSync(
    join(homedir(), '.cache', 'mastra', 'fastembed-models', 'fast-bge-small-en-v1.5', 'model_optimized.onnx'),
  );
}

/** LibSQL file in app-data: thread/message storage + vector semantic recall. */
export function buildMemory(libsqlUrl: string): Memory {
  const lastMessages = envInt('VEYLIN_COMPACT_KEEP', 12);
  const recallEnabled = isFastembedInstalled();
  return new Memory({
    storage: new LibSQLStore({ id: 'veylin-storage', url: libsqlUrl }),
    vector: new LibSQLVector({ id: 'veylin-vector', url: libsqlUrl }),
    ...(recallEnabled ? { embedder: fastembed } : {}),
    options: {
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
