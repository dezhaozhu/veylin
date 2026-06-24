/** Sidecar origin. Empty in Vite dev (proxy forwards `/api`); set at desktop build time. */
const API_ORIGIN = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export function apiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_ORIGIN}${normalized}`;
}

/** Rewrite `/api/*` fetch targets to the sidecar when `VITE_API_URL` is set (Tauri production). */
export function installApiFetchShim(): void {
  if (!API_ORIGIN) return;
  const g = globalThis as typeof globalThis & { __veylinApiFetchShim?: boolean };
  if (g.__veylinApiFetchShim) return;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (!url.startsWith('/api')) return nativeFetch(input, init);
    const resolved = apiUrl(url);
    if (typeof input === 'string') return nativeFetch(resolved, init);
    if (input instanceof URL) return nativeFetch(new URL(resolved), init);
    return nativeFetch(new Request(resolved, input), init);
  };
  g.__veylinApiFetchShim = true;
}
