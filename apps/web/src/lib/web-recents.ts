const STORAGE_KEY = 'veylin-web-recents';
const MAX_RECENTS = 5;

export type WebRecent = {
  url: string;
  title: string;
  visitedAt: number;
};

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function titleFromWebUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '');
  } catch {
    return url;
  }
}

/** True when title is just a URL/host fallback, not a real page name. */
export function isUrlLikeTitle(title: string, url: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return true;
  const short = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const fromUrl = titleFromWebUrl(url);
  if (trimmed === url || trimmed === short || trimmed === fromUrl) return true;
  try {
    const host = new URL(url).hostname;
    if (trimmed === host || trimmed === `www.${host}` || trimmed === host.replace(/^www\./, '')) {
      return true;
    }
  } catch {
    // ignore
  }
  return /^https?:\/\//i.test(trimmed);
}

/** Normalize user input the same way the desktop webview opener does. */
export function normalizeWebUrl(raw: string): string | null {
  return normalizeUrl(raw);
}

export function readWebRecents(): WebRecent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is WebRecent => {
        if (!item || typeof item !== 'object') return false;
        const row = item as Record<string, unknown>;
        return (
          typeof row.url === 'string' &&
          typeof row.title === 'string' &&
          typeof row.visitedAt === 'number'
        );
      })
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function writeWebRecents(next: WebRecent[]): WebRecent[] {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
  return next;
}

export function pushWebRecent(url: string, title?: string): WebRecent[] {
  const normalized = normalizeUrl(url);
  if (!normalized || typeof window === 'undefined') return readWebRecents();

  const incoming = title?.trim() || '';
  const existing = readWebRecents();
  const prev = existing.find((item) => item.url === normalized);
  const keepPrevTitle =
    prev &&
    !isUrlLikeTitle(prev.title, normalized) &&
    (!incoming || isUrlLikeTitle(incoming, normalized));
  const nextTitle = keepPrevTitle
    ? prev.title
    : incoming || titleFromWebUrl(normalized);

  const rest = existing.filter((item) => item.url !== normalized);
  const next: WebRecent[] = [
    { url: normalized, title: nextTitle, visitedAt: Date.now() },
    ...rest,
  ].slice(0, MAX_RECENTS);

  return writeWebRecents(next);
}

/** Update title for an existing recent without changing visit order unless missing. */
export function updateWebRecentTitle(url: string, title: string): WebRecent[] {
  const normalized = normalizeUrl(url);
  const nextTitle = title.trim();
  if (!normalized || !nextTitle || typeof window === 'undefined') {
    return readWebRecents();
  }
  if (isUrlLikeTitle(nextTitle, normalized)) return readWebRecents();

  const existing = readWebRecents();
  const index = existing.findIndex((item) => item.url === normalized);
  if (index < 0) {
    return pushWebRecent(normalized, nextTitle);
  }
  const next = existing.map((item, i) =>
    i === index ? { ...item, title: nextTitle } : item,
  );
  return writeWebRecents(next);
}
