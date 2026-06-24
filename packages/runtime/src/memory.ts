import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { fastembed } from '@mastra/fastembed';

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** LibSQL file in app-data: thread/message storage + vector semantic recall. */
export function buildMemory(libsqlUrl: string): Memory {
  const lastMessages = envInt('VEYLIN_COMPACT_KEEP', 12);
  return new Memory({
    storage: new LibSQLStore({ id: 'veylin-storage', url: libsqlUrl }),
    vector: new LibSQLVector({ id: 'veylin-vector', url: libsqlUrl }),
    embedder: fastembed,
    options: {
      lastMessages,
      semanticRecall: {
        topK: 4,
        messageRange: { before: 2, after: 1 },
        scope: 'resource',
      },
      workingMemory: {
        enabled: true,
        scope: 'resource',
        template: `# Operator & Site Context
- Operator:
- Site / Line:
- Active Work Order:
- Constraints / Safety Notes:
- Open Decisions:
- Activated Skills:
`,
      },
    },
  });
}
