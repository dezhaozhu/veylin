import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { apiUrl, installApiFetchShim } from '@/lib/api-base';
import { hideWebView, isTauri } from '@/lib/tauri-web-view';
import '@/i18n';
import { App } from './App';
import './index.css';

installApiFetchShim();

// Child web-views are native layers above the UI; clear any leftover instance on load
// (e.g. Vite HMR) so the splash screen is not partially covered.
if (isTauri()) {
  void hideWebView();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function healthCheckUrls(): string[] {
  const urls = [apiUrl('/health')];
  if (isTauri()) {
    urls.push('http://127.0.0.1:8787/health', 'http://localhost:8787/health');
  }
  return [...new Set(urls)];
}

function setSplashHint(text: string): void {
  const hint = document.getElementById('splash-hint');
  if (hint && hint.dataset.errorBound !== '1') {
    hint.textContent = text;
  }
}

async function probeHealth(url: string): Promise<boolean> {
  const res = await fetch(url, { cache: 'no-store' });
  return res.ok;
}

async function waitForApiReady(signal: { cancelled: boolean }): Promise<void> {
  let lastError: unknown;
  const urls = healthCheckUrls();
  for (let i = 0; i < 90 && !signal.cancelled; i++) {
    for (const url of urls) {
      try {
        if (await probeHealth(url)) return;
        lastError = new Error(`HTTP error (${url})`);
      } catch (err) {
        lastError = err;
      }
    }
    if (i > 0 && i % 5 === 0) {
      setSplashHint(`正在启动本地服务… (${i + 1})`);
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
  hint.innerHTML =
    `<span style="color:#f87171">本地服务暂未就绪：${message}</span>` +
    ` · <button id="splash-retry" style="background:none;border:none;color:#a855f7;cursor:pointer;font:inherit;text-decoration:underline">重试</button>`;
  document.getElementById('splash-retry')?.addEventListener('click', () => {
    hint.dataset.errorBound = '';
    hint.textContent = '正在启动本地服务…';
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
      return (
        <div className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-lg font-medium">界面加载失败</p>
          <p className="text-muted-foreground max-w-md text-sm">{this.state.error.message}</p>
          <button
            type="button"
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function StartupError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-lg font-medium">本地服务暂未就绪</p>
      <p className="text-muted-foreground max-w-md text-sm">{message}</p>
      <p className="text-muted-foreground max-w-md text-xs">
        桌面端请用 <code className="font-mono">npm run -w @veylin/desktop dev</code> 启动；仅 Web 开发请确认 8787 端口上的 server 已运行。
      </p>
      <button
        type="button"
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm"
        onClick={onRetry}
      >
        重试
      </button>
    </div>
  );
}

function StartupGate() {
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const signal = { cancelled: false };
    setStartupError(null);
    void waitForApiReady(signal)
      .then(() => {
        if (!signal.cancelled) {
          setReady(true);
          removeSplash();
        }
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
    };
  }, [attempt]);

  if (startupError) {
    return <StartupError message={startupError} onRetry={() => setAttempt((value) => value + 1)} />;
  }

  if (ready) {
    return (
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    );
  }

  return null;
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
