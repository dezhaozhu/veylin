import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { apiUrl, installApiFetchShim } from '@/lib/api-base';
import { probeVeylinHealth } from '@/lib/health-probe';
import { hideWebView, isTauri } from '@/lib/tauri-web-view';
import { installDesktopReloadShortcut } from '@/lib/desktop-reload-shortcut';
import { fetchSidecarStatus } from '@/lib/sidecar-status';
import { startupCheckpoint } from '@/lib/startup-profiler';
import { ModuleRegistry } from 'ag-grid-community';
// Register AG-Grid Community modules at startup (order-safe regardless of how the
// grid component is bundled — don't rely on table-grid.tsx's side-effect import).
import './components/assistant-ui/ag-grid-modules';
import { getAgGridLicenseKey } from '@/lib/ag-grid-license';
import i18n from '@/i18n';
import { App } from './App';
import './index.css';

installApiFetchShim();
installDesktopReloadShortcut();
startupCheckpoint('react_shell');

// AG-Grid: Community (MIT) is the default — no Enterprise in the default bundle.
// Enterprise is loaded ONLY here, dynamically, when the user has supplied a key.
{
  const _agKey = getAgGridLicenseKey();
  if (_agKey) {
    // Dynamic import keeps ag-grid-enterprise out of the default chunk.
    void import('ag-grid-enterprise')
      .then((ent) => {
        // AllEnterpriseModule already includes AllCommunityModule; re-registering is safe.
        ModuleRegistry.registerModules([ent.AllEnterpriseModule]);
        ent.LicenseManager.setLicenseKey(_agKey);
      })
      .catch(() => {
        // Fall back to Community silently.
      });
  }
}

if (import.meta.env.DEV) {
  void import('./lib/dev-test-hooks').then((m) => m.installDevTestHooks());
}

// Surface fatal module/load errors on the static splash (before React mounts).
window.addEventListener('error', (event) => {
  const message = event.error instanceof Error ? event.error.message : event.message;
  if (!message) return;
  setSplashHint(i18n.t('splash.uiLoadFailed', { message }));
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason ?? '');
  if (!message) return;
  setSplashHint(i18n.t('splash.uiLoadFailed', { message }));
});

// Child web-views are native layers above the UI; clear any leftover instance on load
// (e.g. Vite HMR) so the splash screen is not partially covered.
if (isTauri()) {
  void hideWebView();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function healthCheckUrls(): string[] {
  return [apiUrl('/health')];
}

function setSplashHint(text: string): void {
  const hint = document.getElementById('splash-hint');
  if (hint && hint.dataset.errorBound !== '1') {
    hint.textContent = text;
  }
}

async function probeHealth(url: string): Promise<boolean> {
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), 5_000);
  try {
    return await probeVeylinHealth(url, { signal: ac.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function waitForApiReady(signal: { cancelled: boolean }): Promise<void> {
  let lastError: unknown;
  const urls = healthCheckUrls();
  for (let i = 0; i < 90 && !signal.cancelled; i++) {
    const sidecar = await fetchSidecarStatus();
    if (sidecar && !sidecar.spawnOk) {
      throw new Error(sidecar.error ?? i18n.t('splash.sidecarSpawnFailed'));
    }

    for (const url of urls) {
      try {
        if (await probeHealth(url)) {
          startupCheckpoint('health_ok');
          return;
        }
        lastError = new Error(`Veylin health check failed (${url})`);
      } catch (err) {
        lastError = err;
      }
    }
    if (i > 0 && i % 5 === 0) {
      setSplashHint(i18n.t('splash.startingServiceProgress', { count: i + 1 }));
    }
    await sleep(i < 20 ? 200 : 500);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function removeSplash(): void {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('is-hidden');
  window.setTimeout(() => splash.remove(), 500);
}

function setSplashError(message: string, onRetry: () => void): void {
  const hint = document.getElementById('splash-hint');
  if (!hint || hint.dataset.errorBound === '1') return;
  hint.dataset.errorBound = '1';
  const serviceNotReady = i18n.t('splash.serviceNotReady', { message });
  const retryLabel = i18n.t('splash.retry');
  hint.innerHTML =
    `<span style="color:#f87171">${serviceNotReady}</span>` +
    ` · <button id="splash-retry" style="background:none;border:none;color:#a855f7;cursor:pointer;font:inherit;text-decoration:underline">${retryLabel}</button>`;
  document.getElementById('splash-retry')?.addEventListener('click', () => {
    hint.dataset.errorBound = '';
    hint.textContent = i18n.t('splash.startingService');
    onRetry();
  });
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <AppErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

function AppErrorFallback({ error }: { error: Error }) {
  const { t } = useTranslation();
  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-lg font-medium">{t('splash.uiLoadFailedTitle')}</p>
      <p className="text-muted-foreground max-w-md text-sm">{error.message}</p>
      <button
        type="button"
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm"
        onClick={() => window.location.reload()}
      >
        {t('splash.reload')}
      </button>
    </div>
  );
}

function StartupError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-lg font-medium">{t('splash.serviceNotReadyTitle')}</p>
      <p className="text-muted-foreground max-w-md text-sm">{message}</p>
      <p
        className="text-muted-foreground max-w-md text-xs"
        dangerouslySetInnerHTML={{ __html: t('splash.desktopHint') }}
      />
      <button
        type="button"
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm"
        onClick={onRetry}
      >
        {t('splash.retry')}
      </button>
    </div>
  );
}

function StartupLoading() {
  const { t } = useTranslation();
  return (
    <div className="bg-background text-foreground flex min-h-dvh items-center justify-center p-8">
      <p className="text-muted-foreground text-sm">{t('splash.startingService')}</p>
    </div>
  );
}

function StartupGate() {
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const signal = { cancelled: false };
    const failsafe = window.setTimeout(() => removeSplash(), 45_000);
    setStartupError(null);
    void waitForApiReady(signal)
      .then(() => {
        if (signal.cancelled) return;
        setReady(true);
      })
      .catch((err) => {
        if (!signal.cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setStartupError(message);
          setSplashError(message, () => setAttempt((value) => value + 1));
        }
      });
    return () => {
      signal.cancelled = true;
      window.clearTimeout(failsafe);
    };
  }, [attempt]);

  useEffect(() => {
    if (!ready) return;
    startupCheckpoint('react_mount');
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        removeSplash();
        startupCheckpoint('assistant_ready');
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [ready]);

  if (startupError) {
    removeSplash();
    return <StartupError message={startupError} onRetry={() => setAttempt((value) => value + 1)} />;
  }

  if (ready) {
    return (
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    );
  }

  return <StartupLoading />;
}

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <StartupGate />
    </TooltipProvider>
  </StrictMode>,
);
