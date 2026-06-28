const START_MS = Date.now();

export function isStartupProfilingEnabled(): boolean {
  return process.env.VEYLIN_PROFILE_STARTUP === '1';
}

export function startupCheckpoint(name: string): void {
  if (!isStartupProfilingEnabled()) return;
  const mem = process.memoryUsage();
  const rssMb = Math.round(mem.rss / 1024 / 1024);
  const heapMb = Math.round(mem.heapUsed / 1024 / 1024);
  const elapsed = Date.now() - START_MS;
  console.info(`[startup] ${name} +${elapsed}ms rss=${rssMb}MB heap=${heapMb}MB`);
}
