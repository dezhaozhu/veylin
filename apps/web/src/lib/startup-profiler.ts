const START_MS = typeof performance !== 'undefined' ? performance.now() : Date.now();

export function isStartupProfilingEnabled(): boolean {
  if (import.meta.env.VITE_VEYLIN_PROFILE_STARTUP === '1') return true;
  try {
    return localStorage.getItem('VEYLIN_PROFILE_STARTUP') === '1';
  } catch {
    return false;
  }
}

function memorySnapshot(): string {
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize: number };
  };
  if (perf.memory?.usedJSHeapSize) {
    const mb = Math.round(perf.memory.usedJSHeapSize / 1024 / 1024);
    return `heap=${mb}MB`;
  }
  return 'heap=n/a';
}

export function startupCheckpoint(name: string): void {
  if (!isStartupProfilingEnabled()) return;
  const elapsed = Math.round(
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) - START_MS,
  );
  console.info(`[startup] ${name} +${elapsed}ms ${memorySnapshot()}`);
}
