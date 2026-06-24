import { LRUCache } from 'lru-cache';

export type CacheEntry = {
  bytes: number;
  code: number;
  codeText: string;
  content: string;
  contentType: string;
};

const CACHE_TTL_MS = Number(process.env.VEYLIN_WEB_FETCH_CACHE_TTL_MS ?? 15 * 60 * 1000);
const MAX_CACHE_BYTES = Number(process.env.VEYLIN_WEB_FETCH_CACHE_MAX_BYTES ?? 50 * 1024 * 1024);

export const urlCache = new LRUCache<string, CacheEntry>({
  maxSize: MAX_CACHE_BYTES,
  ttl: CACHE_TTL_MS,
});

export function clearWebFetchCache(): void {
  urlCache.clear();
}
