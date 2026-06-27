import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LOCAL_RERANKER_HF_MODEL_ID,
  ensureDataDir,
  isRerankerModelOnDisk,
  rerankerCacheDir,
} from '@veylin/db';
import { applyTransformersHfEndpoint } from './hf-endpoint';

export { LOCAL_RERANKER_HF_MODEL_ID as DEFAULT_RERANKER_MODEL } from '@veylin/db';

export type RerankerDownloadPhase = 'idle' | 'downloading' | 'ready' | 'error';

export type RerankerDownloadState = {
  phase: RerankerDownloadPhase;
  progress: number;
  message: string;
  file?: string;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type RerankerStatus = {
  available: boolean;
  enabled: boolean;
  installed: boolean;
  modelId: string;
  download: RerankerDownloadState;
  installedAt: string | null;
  lastError: string | null;
  hfEndpoint: string | null;
};

type StoredRerankerSettings = {
  enabled: boolean;
  modelId: string;
  installedAt?: string | null;
  lastError?: string | null;
};

type ProgressInfo = {
  status: string;
  file?: string;
  progress?: number;
};

type RerankRuntime = {
  tokenizer: {
    (
      text: string,
      options?: { text_pair?: string; padding?: boolean; truncation?: boolean },
    ): Promise<Record<string, unknown>>;
    (...args: unknown[]): Promise<Record<string, unknown>>;
  };
  model: (inputs: Record<string, unknown>) => Promise<{ logits: { data: ArrayLike<number> } }>;
};

const SETTINGS_FILE = 'reranker-settings.json';
const ENV_DISABLED = process.env.RAG_RERANKER === '0';

let downloadState: RerankerDownloadState = {
  phase: 'idle',
  progress: 0,
  message: '',
  error: null,
};
let downloadPromise: Promise<void> | null = null;
let runtime: RerankRuntime | null = null;
let runtimeModelId: string | null = null;
let lastHfEndpoint: string | null = null;

function settingsPath(): string {
  return join(ensureDataDir(), SETTINGS_FILE);
}

function resolveModelId(): string {
  return process.env.RAG_RERANKER_MODEL?.trim() || LOCAL_RERANKER_HF_MODEL_ID;
}

function readSettings(): StoredRerankerSettings {
  const path = settingsPath();
  if (!existsSync(path)) {
    return { enabled: false, modelId: resolveModelId(), installedAt: null, lastError: null };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredRerankerSettings>;
    return {
      enabled: raw.enabled === true,
      modelId: typeof raw.modelId === 'string' && raw.modelId.trim() ? raw.modelId.trim() : resolveModelId(),
      installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : null,
      lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    };
  } catch {
    return { enabled: false, modelId: resolveModelId(), installedAt: null, lastError: null };
  }
}

function writeSettings(settings: StoredRerankerSettings): void {
  mkdirSync(ensureDataDir(), { recursive: true });
  writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

export function createStepProgressCallback(
  step: 'tokenizer' | 'model',
  onUpdate: (progress: number, message: string, file?: string) => void,
): (info: ProgressInfo) => void {
  const base = step === 'tokenizer' ? 0 : 50;
  const range = 50;
  return (info) => {
    const file = info.file ?? '';
    if (info.status === 'initiate' || info.status === 'download') {
      onUpdate(base, file || step, file || undefined);
      return;
    }
    if (info.status === 'progress' && info.progress != null) {
      onUpdate(Math.round(base + (info.progress / 100) * range), file || step, file || undefined);
      return;
    }
    if (info.status === 'done') {
      onUpdate(base + range, file || step, file || undefined);
    }
  };
}

async function probeModelInstalled(modelId: string): Promise<boolean> {
  return isRerankerModelOnDisk(modelId);
}

async function configureTransformersEnv(
  transformers: typeof import('@huggingface/transformers'),
): Promise<void> {
  transformers.env.cacheDir = rerankerCacheDir();
  lastHfEndpoint = await applyTransformersHfEndpoint(transformers);
}

function updateDownloadState(patch: Partial<RerankerDownloadState>): void {
  downloadState = { ...downloadState, ...patch };
}

async function loadRuntime(modelId: string): Promise<RerankRuntime> {
  if (runtime && runtimeModelId === modelId) return runtime;
  const transformers = await import('@huggingface/transformers');
  await configureTransformersEnv(transformers);
  const tokenizer = await transformers.AutoTokenizer.from_pretrained(modelId, { local_files_only: true });
  const model = await transformers.AutoModelForSequenceClassification.from_pretrained(modelId, {
    local_files_only: true,
  });
  runtime = { tokenizer, model } as RerankRuntime;
  runtimeModelId = modelId;
  return runtime;
}

function clearRuntime(): void {
  runtime = null;
  runtimeModelId = null;
}

export async function getRerankerStatus(): Promise<RerankerStatus> {
  const settings = readSettings();
  const modelId = resolveModelId();
  let installedAt = settings.installedAt ?? null;
  let installed = false;

  if (downloadState.phase === 'downloading') {
    installed = false;
  } else {
    installed = await probeModelInstalled(modelId);
    if (installed) {
      if (!installedAt) {
        installedAt = new Date().toISOString();
        writeSettings({ ...settings, installedAt, lastError: null, enabled: true });
        settings.enabled = true;
      }
    } else if (installedAt) {
      installedAt = null;
      writeSettings({ ...settings, installedAt: null, enabled: false });
    }
  }

  const effectivePhase =
    downloadState.phase === 'downloading'
      ? 'downloading'
      : downloadState.phase === 'error'
        ? 'error'
        : installed
          ? 'ready'
          : 'idle';

  return {
    available: !ENV_DISABLED,
    enabled: !ENV_DISABLED && settings.enabled && installed,
    installed,
    modelId,
    download: {
      ...downloadState,
      phase: effectivePhase,
      progress: effectivePhase === 'ready' ? 100 : downloadState.progress,
    },
    installedAt: installed ? installedAt : null,
    lastError: settings.lastError ?? null,
    hfEndpoint: lastHfEndpoint,
  };
}

export async function setRerankerEnabled(enabled: boolean): Promise<RerankerStatus> {
  if (ENV_DISABLED) {
    throw new Error('Reranker is disabled by RAG_RERANKER=0');
  }
  const settings = readSettings();
  const installed = await probeModelInstalled(resolveModelId());
  if (enabled && !installed) {
    throw new Error('Reranker model is not installed');
  }
  writeSettings({ ...settings, enabled });
  if (!enabled) clearRuntime();
  return getRerankerStatus();
}

export function startRerankerDownload(): { ok: boolean; message?: string } {
  if (ENV_DISABLED) {
    return { ok: false, message: 'Reranker is disabled by RAG_RERANKER=0' };
  }
  if (downloadPromise) {
    return { ok: true, message: 'already downloading' };
  }

  const modelId = resolveModelId();
  const settings = readSettings();

  downloadPromise = (async () => {
    updateDownloadState({
      phase: 'downloading',
      progress: 0,
      message: 'tokenizer',
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });

    try {
      const transformers = await import('@huggingface/transformers');
      await configureTransformersEnv(transformers);

      const tokenizerCb = createStepProgressCallback('tokenizer', (progress, message, file) => {
        updateDownloadState({ progress, message, file });
      });
      const modelCb = createStepProgressCallback('model', (progress, message, file) => {
        updateDownloadState({ progress, message, file });
      });

      updateDownloadState({ message: 'tokenizer', progress: 0 });
      const tokenizer = await transformers.AutoTokenizer.from_pretrained(modelId, {
        progress_callback: tokenizerCb,
      });

      updateDownloadState({ message: 'model', progress: 50 });
      const model = await transformers.AutoModelForSequenceClassification.from_pretrained(modelId, {
        progress_callback: modelCb,
      });

      runtime = { tokenizer, model } as RerankRuntime;
      runtimeModelId = modelId;

      const installedAt = new Date().toISOString();
      writeSettings({
        ...settings,
        modelId,
        installedAt,
        lastError: null,
        enabled: true,
      });

      updateDownloadState({
        phase: 'ready',
        progress: 100,
        message: 'ready',
        error: null,
        finishedAt: installedAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      clearRuntime();
      writeSettings({
        ...settings,
        installedAt: null,
        enabled: false,
        lastError: message,
      });
      updateDownloadState({
        phase: 'error',
        progress: 0,
        message,
        error: message,
        finishedAt: new Date().toISOString(),
      });
    } finally {
      downloadPromise = null;
    }
  })();

  return { ok: true };
}

export async function removeRerankerModel(): Promise<RerankerStatus> {
  if (downloadPromise) {
    throw new Error('Cannot remove model while downloading');
  }
  const settings = readSettings();
  clearRuntime();
  const cacheDir = rerankerCacheDir();
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true });
  }
  writeSettings({
    ...settings,
    enabled: false,
    installedAt: null,
    lastError: null,
  });
  updateDownloadState({
    phase: 'idle',
    progress: 0,
    message: '',
    file: undefined,
    error: null,
    startedAt: null,
    finishedAt: null,
  });
  return getRerankerStatus();
}

export async function getRerankRuntime(): Promise<RerankRuntime | null> {
  if (ENV_DISABLED) return null;
  const settings = readSettings();
  if (!settings.enabled) return null;
  const modelId = resolveModelId();
  const installed = await probeModelInstalled(modelId);
  if (!installed) return null;
  try {
    return await loadRuntime(modelId);
  } catch (err) {
    console.warn('[rag] reranker runtime unavailable:', err);
    return null;
  }
}

export const __test__ = {
  createStepProgressCallback,
  readSettings,
  writeSettings,
  settingsPath,
  resetForTest: () => {
    downloadState = { phase: 'idle', progress: 0, message: '', error: null };
    downloadPromise = null;
    clearRuntime();
  },
};
