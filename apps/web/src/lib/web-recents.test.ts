import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  normalizeWebUrl,
  pushWebRecent,
  readWebRecents,
  titleFromWebUrl,
  updateWebRecentTitle,
} from './web-recents.ts';

function installMemoryStorage(): void {
  const store = new Map<string, string>();
  const memoryStorage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
}

describe('web-recents', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it('normalizes bare hosts to https', () => {
    assert.equal(normalizeWebUrl('localhost:8000'), 'https://localhost:8000/');
    assert.equal(normalizeWebUrl('http://localhost:8000'), 'http://localhost:8000/');
  });

  it('rejects empty input', () => {
    assert.equal(normalizeWebUrl(''), null);
    assert.equal(normalizeWebUrl('   '), null);
  });

  it('builds a compact title from the URL', () => {
    assert.equal(titleFromWebUrl('https://example.com/docs/hooks'), 'example.com/docs/hooks');
    assert.equal(titleFromWebUrl('https://example.com/'), 'example.com');
  });

  it('stores recents newest-first and dedupes by url', () => {
    pushWebRecent('https://a.example/', 'A');
    pushWebRecent('https://b.example/', 'B');
    pushWebRecent('https://a.example/', 'A again');

    const recents = readWebRecents();
    assert.equal(recents.length, 2);
    assert.equal(recents[0]?.url, 'https://a.example/');
    assert.equal(recents[0]?.title, 'A again');
    assert.equal(recents[1]?.url, 'https://b.example/');
  });

  it('keeps a real page title when reopening with a url-like fallback', () => {
    pushWebRecent('https://www.bilibili.com/video/x', '某个视频标题');
    pushWebRecent(
      'https://www.bilibili.com/video/x',
      'www.bilibili.com/video/x',
    );
    const recents = readWebRecents();
    assert.equal(recents[0]?.title, '某个视频标题');
  });

  it('updates title once the real document title is known', () => {
    pushWebRecent('https://example.com/post', 'example.com/post');
    const next = updateWebRecentTitle('https://example.com/post', 'Example Post');
    assert.equal(next[0]?.title, 'Example Post');
  });
});
