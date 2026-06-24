const MAX_URL_LENGTH = 2000;

/** Hostnames that must never be fetched (SSRF guard). */
const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
]);

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [, a, b] = m.map(Number) as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  return false;
}

export function validateUrl(url: string): boolean {
  if (url.length > MAX_URL_LENGTH) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return false;
  if (isPrivateIpv4(host)) return false;
  if (host.endsWith('.local') || host.endsWith('.internal')) return false;
  const parts = host.split('.');
  if (parts.length < 2 && !host.includes(':')) return false;
  return true;
}

/**
 * Same-host redirects (including www add/remove) are followed automatically.
 * Cross-host redirects are surfaced to the agent (the agent WebFetch).
 */
export function isPermittedRedirect(originalUrl: string, redirectUrl: string): boolean {
  try {
    const a = new URL(originalUrl);
    const b = new URL(redirectUrl);
    if (b.protocol !== a.protocol) return false;
    if (b.port !== a.port) return false;
    if (b.username || b.password) return false;
    const stripWww = (h: string) => h.replace(/^www\./, '');
    return stripWww(a.hostname) === stripWww(b.hostname);
  } catch {
    return false;
  }
}

export function upgradeToHttps(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
      return parsed.toString();
    }
  } catch {
    /* keep original */
  }
  return url;
}

export function httpStatusText(code: number): string {
  const map: Record<number, string> = {
    200: 'OK',
    301: 'Moved Permanently',
    302: 'Found',
    307: 'Temporary Redirect',
    308: 'Permanent Redirect',
  };
  return map[code] ?? String(code);
}
