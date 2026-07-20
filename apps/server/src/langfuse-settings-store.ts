import type { Mastra } from '@mastra/core';
import type { Observability } from '@mastra/observability';
import { getTenantSettingsRow, upsertTenantSettings } from '@veylin/db';
import {
  DEFAULT_LANGFUSE_BASE_URL,
  langfuseSettingsPatchSchema,
  langfuseSettingsSchema,
  type LangfuseSettingsPatch,
  type LangfuseSettingsStored,
} from '@veylin/shared';
import {
  buildObservabilityFromConfig,
  resolveLangfuseConfig,
  setRuntimeLangfuseOverrides,
} from '@veylin/runtime';

export type LangfuseSettingsInput = LangfuseSettingsPatch;

export type LangfuseSettingsView = {
  enabled: boolean;
  publicKey: string;
  baseUrl: string;
  hasSecretKey: boolean;
};

const EMPTY_STORED: LangfuseSettingsStored = langfuseSettingsSchema.parse({});

export function normalizeLangfuseSettings(
  raw: Partial<LangfuseSettingsStored> | undefined,
): LangfuseSettingsStored {
  const parsed = langfuseSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { ...EMPTY_STORED };
}

export function toLangfuseSettingsView(settings: LangfuseSettingsStored): LangfuseSettingsView {
  return {
    enabled: settings.enabled,
    publicKey: settings.publicKey,
    baseUrl: settings.baseUrl || DEFAULT_LANGFUSE_BASE_URL,
    hasSecretKey: settings.secretKey.trim().length > 0,
  };
}

/** Merge patch into existing; omit/blank secretKey keeps the previous secret. */
export function mergeLangfuseSettings(
  existing: LangfuseSettingsStored,
  patch: LangfuseSettingsPatch,
): LangfuseSettingsStored {
  const secretKey =
    patch.secretKey !== undefined && patch.secretKey.trim().length > 0
      ? patch.secretKey
      : existing.secretKey;
  return normalizeLangfuseSettings({
    ...existing,
    ...patch,
    secretKey,
  });
}

function isEmptyStored(settings: LangfuseSettingsStored): boolean {
  return (
    !settings.enabled &&
    settings.publicKey.trim() === '' &&
    settings.secretKey.trim() === ''
  );
}

async function loadStoredSettings(tenantId: string): Promise<LangfuseSettingsStored> {
  const row = await getTenantSettingsRow(tenantId);
  const raw = row?.langfuseSettings as Partial<LangfuseSettingsStored> | undefined;
  return normalizeLangfuseSettings(raw);
}

let applyMastra: Mastra | null = null;

/** Bind the Mastra instance used for hot-reloading observability exporters. */
export function bindLangfuseRuntime(mastra: Mastra): void {
  applyMastra = mastra;
}

export async function getLangfuseSettings(tenantId: string): Promise<LangfuseSettingsView> {
  const stored = await loadStoredSettings(tenantId);
  return toLangfuseSettingsView(stored);
}

export async function clearLangfuseSettings(tenantId: string): Promise<LangfuseSettingsView> {
  await upsertTenantSettings(tenantId, { langfuseSettings: EMPTY_STORED });
  await applyLangfuseToRuntime(EMPTY_STORED);
  return toLangfuseSettingsView(EMPTY_STORED);
}

export async function updateLangfuseSettings(
  tenantId: string,
  patch: LangfuseSettingsInput,
): Promise<LangfuseSettingsView> {
  const parsedPatch = langfuseSettingsPatchSchema.safeParse(patch);
  if (!parsedPatch.success) {
    throw new Error('Invalid Langfuse settings payload');
  }
  const existing = await loadStoredSettings(tenantId);
  const next = mergeLangfuseSettings(existing, parsedPatch.data);
  await upsertTenantSettings(tenantId, { langfuseSettings: next });
  await applyLangfuseToRuntime(next);
  return toLangfuseSettingsView(next);
}

export async function applyTenantLangfuseSettings(tenantId: string): Promise<void> {
  const stored = await loadStoredSettings(tenantId);
  await applyLangfuseToRuntime(stored);
}

function envLangfuseSettings(): LangfuseSettingsStored | null {
  const raw = process.env.LANGFUSE_ENABLED?.trim().toLowerCase();
  const enabled = raw === 'true' || raw === '1';
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim() ?? '';
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim() ?? '';
  if (!enabled || !publicKey || !secretKey) return null;
  const baseUrl =
    process.env.LANGFUSE_BASE_URL?.trim() ||
    process.env.LANGFUSE_HOST?.trim() ||
    DEFAULT_LANGFUSE_BASE_URL;
  return normalizeLangfuseSettings({ enabled: true, publicKey, secretKey, baseUrl });
}

/** Seed tenant Langfuse settings from LANGFUSE_* env when DB is empty. */
export async function seedLangfuseSettingsFromEnvIfEmpty(tenantId: string): Promise<void> {
  const stored = await loadStoredSettings(tenantId);
  if (!isEmptyStored(stored)) {
    await applyLangfuseToRuntime(stored);
    return;
  }

  const fromEnv = envLangfuseSettings();
  if (!fromEnv) {
    await applyLangfuseToRuntime(null);
    return;
  }

  await upsertTenantSettings(tenantId, { langfuseSettings: fromEnv });
  await applyLangfuseToRuntime(fromEnv);
  console.info('[veylin] Langfuse settings seeded from LANGFUSE_* env vars');
}

/**
 * Write runtime override and hot-reload Mastra observability exporters.
 * On rebuild failure, config remains in DB / overrides; next process start applies it.
 */
export async function applyLangfuseToRuntime(
  settings: LangfuseSettingsStored | null,
): Promise<void> {
  if (!settings || isEmptyStored(settings)) {
    setRuntimeLangfuseOverrides(null);
  } else {
    setRuntimeLangfuseOverrides(settings);
  }

  const mastra = applyMastra;
  if (!mastra?.observability) return;

  try {
    const cfg = resolveLangfuseConfig();
    const rebuilt = buildObservabilityFromConfig(cfg);
    const instance = rebuilt.getDefaultInstance();
    if (!instance) {
      throw new Error('missing default observability instance');
    }
    const obs = mastra.observability as Observability;
    await obs.flush();
    obs.clear();
    obs.registerInstance('default', instance, true);
    obs.setMastraContext({ mastra });
  } catch (err) {
    console.warn(
      '[observability] failed to hot-reload Langfuse config; will apply on next restart',
      err,
    );
  }
}
