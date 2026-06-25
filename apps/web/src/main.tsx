import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { apiUrl, installApiFetchShim } from '@/lib/api-base';
import '@/i18n';
import { App } from './App';
import './index.css';

installApiFetchShim();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForApiReady(signal: { cancelled: boolean }): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < 120 && !signal.cancelled; i++) {
    try {
      const res = await fetch(apiUrl('/health'), { cache: 'no-store' });
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(i < 30 ? 150 : 400);
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

function StartupGate() {
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const signal = { cancelled: false };
    void waitForApiReady(signal)
      .then(() => {
        if (!signal.cancelled) {
          setReady(true);
          removeSplash();
        }
      })
      .catch((err) => {
        if (!signal.cancelled) {
          setSplashError(err instanceof Error ? err.message : String(err), () =>
            setAttempt((value) => value + 1),
          );
        }
      });
    return () => {
      signal.cancelled = true;
    };
  }, [attempt]);

  if (ready) return <App />;
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
