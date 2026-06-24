/** Code/documentation hosts where fetched markdown may be quoted more freely. */
const PREAPPROVED_HOSTS = new Set([
  'developer.mozilla.org',
  'docs.python.org',
  'nodejs.org',
  'react.dev',
  'nextjs.org',
  'go.dev',
  'pkg.go.dev',
  'www.typescriptlang.org',
  'doc.rust-lang.org',
  'fastapi.tiangolo.com',
  'docs.djangoproject.com',
  'modelcontextprotocol.io',
  'github.com',
]);

export function isPreapprovedHost(hostname: string, pathname = ''): boolean {
  const host = hostname.toLowerCase();
  if (PREAPPROVED_HOSTS.has(host)) return true;
  // github.com/org paths (the agent pattern)
  if (host === 'github.com' && pathname.startsWith('/')) return true;
  return false;
}

export function isPreapprovedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return isPreapprovedHost(parsed.hostname, parsed.pathname);
  } catch {
    return false;
  }
}
