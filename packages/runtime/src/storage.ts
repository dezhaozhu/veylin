import { LibSQLStore } from '@mastra/libsql';
import { LangfuseExporter } from '@mastra/langfuse';
import { Observability, MastraStorageExporter } from '@mastra/observability';

export function buildStorage(libsqlUrl: string): LibSQLStore {
  return new LibSQLStore({ id: 'veylin-mastra-store', url: libsqlUrl });
}

/** ~32MB — enough for a 20MB attachment as a base64 data URI in span payloads. */
const LANGFUSE_MAX_STRING_LENGTH = 32 * 1024 * 1024;

export type LangfuseResolvedConfig = {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
  environment?: string;
  release?: string;
};

/**
 * Resolve Langfuse exporter config from env.
 * Returns null when disabled or when keys are missing (with a warn).
 */
export function resolveLangfuseConfig(
  env: NodeJS.ProcessEnv = process.env,
): LangfuseResolvedConfig | null {
  const raw = env.LANGFUSE_ENABLED?.trim().toLowerCase();
  const enabled = raw === 'true' || raw === '1';
  if (!enabled) return null;

  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim() ?? '';
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim() ?? '';
  if (!publicKey || !secretKey) {
    console.warn(
      '[observability] LANGFUSE_ENABLED is set but LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY are missing; skipping Langfuse exporter',
    );
    return null;
  }

  const baseUrl = (
    env.LANGFUSE_BASE_URL?.trim() ||
    env.LANGFUSE_HOST?.trim() ||
    'https://cloud.langfuse.com'
  );

  return {
    publicKey,
    secretKey,
    baseUrl,
    environment: env.LANGFUSE_ENVIRONMENT?.trim() || env.NODE_ENV?.trim() || undefined,
    release: env.LANGFUSE_RELEASE?.trim() || undefined,
  };
}

export function buildObservability(
  env: NodeJS.ProcessEnv = process.env,
): Observability {
  const exporters: Array<MastraStorageExporter | LangfuseExporter> = [
    new MastraStorageExporter(),
  ];

  const langfuse = resolveLangfuseConfig(env);
  if (langfuse) {
    exporters.push(
      new LangfuseExporter({
        publicKey: langfuse.publicKey,
        secretKey: langfuse.secretKey,
        baseUrl: langfuse.baseUrl,
        environment: langfuse.environment,
        release: langfuse.release,
      }),
    );
  }

  return new Observability({
    configs: {
      default: {
        serviceName: 'veylin',
        exporters,
        ...(langfuse
          ? {
              serializationOptions: {
                maxStringLength: LANGFUSE_MAX_STRING_LENGTH,
              },
            }
          : {}),
      },
    },
  });
}
