import { LibSQLStore } from '@mastra/libsql';
import { LangfuseExporter } from '@mastra/langfuse';
import { Observability, MastraStorageExporter } from '@mastra/observability';
import {
  DEFAULT_LANGFUSE_BASE_URL,
  type LangfuseSettingsStored,
} from '@veylin/shared';

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

export type RuntimeLangfuseOverrides = LangfuseSettingsStored;

let runtimeLangfuseOverrides: RuntimeLangfuseOverrides | null = null;

export function setRuntimeLangfuseOverrides(
  overrides: RuntimeLangfuseOverrides | null,
): void {
  runtimeLangfuseOverrides = overrides ? { ...overrides } : null;
}

export function getRuntimeLangfuseOverrides(): RuntimeLangfuseOverrides | null {
  return runtimeLangfuseOverrides ? { ...runtimeLangfuseOverrides } : null;
}

function resolveFromEnv(env: NodeJS.ProcessEnv): LangfuseResolvedConfig | null {
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

  const baseUrl =
    env.LANGFUSE_BASE_URL?.trim() ||
    env.LANGFUSE_HOST?.trim() ||
    DEFAULT_LANGFUSE_BASE_URL;

  return {
    publicKey,
    secretKey,
    baseUrl,
    environment: env.LANGFUSE_ENVIRONMENT?.trim() || env.NODE_ENV?.trim() || undefined,
    release: env.LANGFUSE_RELEASE?.trim() || undefined,
  };
}

function resolveFromOverride(
  override: RuntimeLangfuseOverrides,
  env: NodeJS.ProcessEnv,
): LangfuseResolvedConfig | null {
  if (!override.enabled) return null;

  const publicKey = override.publicKey?.trim() ?? '';
  const secretKey = override.secretKey?.trim() ?? '';
  if (!publicKey || !secretKey) {
    console.warn(
      '[observability] Langfuse override is enabled but publicKey / secretKey are missing; skipping Langfuse exporter',
    );
    return null;
  }

  return {
    publicKey,
    secretKey,
    baseUrl: override.baseUrl?.trim() || DEFAULT_LANGFUSE_BASE_URL,
    environment: env.LANGFUSE_ENVIRONMENT?.trim() || env.NODE_ENV?.trim() || undefined,
    release: env.LANGFUSE_RELEASE?.trim() || undefined,
  };
}

/**
 * Resolve Langfuse exporter config from runtime override ∪ env.
 * Override wins when set; otherwise falls back to LANGFUSE_* env.
 * Returns null when disabled or when keys are missing (with a warn).
 */
export function resolveLangfuseConfig(
  env: NodeJS.ProcessEnv = process.env,
): LangfuseResolvedConfig | null {
  if (runtimeLangfuseOverrides) {
    return resolveFromOverride(runtimeLangfuseOverrides, env);
  }
  return resolveFromEnv(env);
}

export function buildObservabilityFromConfig(
  langfuse: LangfuseResolvedConfig | null,
): Observability {
  const exporters: Array<MastraStorageExporter | LangfuseExporter> = [
    new MastraStorageExporter(),
  ];

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

export function buildObservability(
  env: NodeJS.ProcessEnv = process.env,
): Observability {
  return buildObservabilityFromConfig(resolveLangfuseConfig(env));
}
