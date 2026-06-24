import { LibSQLStore } from '@mastra/libsql';
import { Observability, MastraStorageExporter } from '@mastra/observability';

export function buildStorage(libsqlUrl: string): LibSQLStore {
  return new LibSQLStore({ id: 'veylin-mastra-store', url: libsqlUrl });
}

export function buildObservability(): Observability {
  return new Observability({
    configs: {
      default: {
        serviceName: 'veylin',
        exporters: [new MastraStorageExporter()],
      },
    },
  });
}
