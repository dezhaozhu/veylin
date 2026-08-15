import { useCallback, useEffect, useMemo, useState } from 'react';
import { mergeAbortSignals } from '@/lib/transport-reconnect';
import { SCENE_CARD_TOOL, sceneCardArgs, type SceneCardColumn } from './scene-card-grid';
import { cacheKeyFor, entriesDiffer, readSceneCardCache, writeSceneCardCache } from './scene-card-cache';

/**
 * Fetches EVERY 项目首页 card (source × capability server) in one place.
 *
 * The cells used to fetch themselves, which was fine while each one only had
 * to render its own widget. The 对比合并视图 (Phase 4) has to decide between a
 * merged table and side-by-side widgets by looking at ALL payloads at once, so
 * the fetch is lifted here and the cell became a pure renderer of the payload
 * it is handed.
 *
 * `null` = still loading (all calls are in flight together and settle within
 * milliseconds of each other; a single page-level loader avoids rendering
 * side-by-side cards for a beat and then replacing them with the table). The
 * effect re-runs on mount / project change only — the view is conditionally
 * mounted, so opening it refetches; there is no polling.
 *
 * BLAST RADIUS: because the page waits for every call, ONE capability server
 * that accepts the connection and then never answers would otherwise spin the
 * loader forever — and it would block the honest side-by-side fallback too,
 * which is exactly the state that fallback exists for. So every request gets
 * its own deadline ({@link SCENE_CARD_FETCH_TIMEOUT_MS}) and a timed-out card
 * settles as a FAILED card, identical in shape to an HTTP error: the page
 * always proceeds, degrading per `canMergeCards`, never hanging.
 */

export type SceneCardFetch = { status: 'error' } | { status: 'ready'; result: unknown };

export type SceneCardEntry = {
  source: string;
  server: string;
  resourceUri: string;
  args: Record<string, unknown>;
  argsKey: string;
  fetched: SceneCardFetch;
};

export type SceneCardSpec = Omit<SceneCardEntry, 'fetched'>;

/**
 * Deadline for ONE card fetch (same idiom + constant style as the transport's
 * {@link import('@/lib/transport-reconnect').POST_FETCH_TIMEOUT_MS}, but far
 * shorter: that one guards a long-lived chat stream POST, this one guards a
 * page the user is staring at).
 */
export const SCENE_CARD_FETCH_TIMEOUT_MS = 20_000;

/**
 * One card's request, settled into an entry — it NEVER rejects. Every failure
 * mode (HTTP status, network error, its own timeout, the caller's abort on
 * unmount) collapses to the same `{status: 'error'}`, because from the page's
 * point of view they are the same fact: this card has no payload, so it can
 * neither be merged nor rendered, and the rest of the page must carry on.
 *
 * `fetchImpl`/`timeoutMs` exist so this stays testable without a DOM or a
 * clock; production callers pass neither.
 */
export async function fetchSceneCard(
  hostUrl: string,
  spec: SceneCardSpec,
  options: {
    signal?: AbortSignal | null;
    timeoutMs?: number;
    fetchImpl?: typeof globalThis.fetch;
  } = {},
): Promise<SceneCardEntry> {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), options.timeoutMs ?? SCENE_CARD_FETCH_TIMEOUT_MS);
  try {
    const r = await doFetch(hostUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'tools/call',
        params: { name: SCENE_CARD_TOOL, arguments: spec.args },
      }),
      // The caller's signal (unmount / project change) and this request's own
      // deadline, whichever fires first.
      signal: mergeAbortSignals(options.signal, timeout.signal),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { ...spec, fetched: { status: 'ready', result: (await r.json()) as unknown } };
  } catch {
    // One card's failure never fails the page — it renders its own error line
    // (and, being display-less, drops the page to the side-by-side fallback).
    return { ...spec, fetched: { status: 'error' } };
  } finally {
    clearTimeout(timer);
  }
}

export type SceneCardState = {
  entries: SceneCardEntry[] | null;
  /** 眼前这批卡是什么时候取回来的(缓存命中时就是上次那一刻) */
  at: string | null;
  /** 后台正在核对(不遮挡已有内容) */
  revalidating: boolean;
  refresh: () => void;
};

/**
 * **默认吃缓存,打开时后台核对一次,变了才换,不定时轮询**(用户定的规矩)。
 *
 * 之前是每次打开都清空再重取 —— 服务端那头 shangzhong 要 2.7s(现已降到 0.3s),
 * 于是每进一次项目页都干等一次白屏。现在缓存立即上屏,核对在后台走;结果一样就
 * 什么都不动,免得白闪。
 */
export function useSceneCardPayloads(
  hostUrl: string,
  columns: readonly SceneCardColumn[],
  sources: readonly string[],
): SceneCardState {
  // Effect identity by VALUE, not array identity — the caller rebuilds these
  // arrays on every render.
  const plan = useMemo(
    () =>
      sources.flatMap((source) =>
        columns.map((column) => {
          const args = sceneCardArgs(sources, source);
          return {
            source,
            server: column.server,
            resourceUri: column.resourceUri,
            args,
            argsKey: JSON.stringify(args),
          };
        }),
      ),
    [columns, sources],
  );
  const planKey = JSON.stringify(plan);

  const [entries, setEntries] = useState<SceneCardEntry[] | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const specs = JSON.parse(planKey) as SceneCardSpec[];
    if (specs.length === 0) {
      setEntries([]);
      setAt(null);
      return;
    }
    const key = cacheKeyFor(hostUrl, specs);
    const cached = readSceneCardCache(key);
    // 缓存立即上屏 —— 不再"清空 → 白屏 → 等几秒"
    setEntries((cached?.entries as SceneCardEntry[] | undefined) ?? null);
    setAt(cached?.at ?? null);

    let alive = true;
    const cancel = new AbortController();
    setRevalidating(true);
    void Promise.all(
      specs.map((spec) => fetchSceneCard(hostUrl, spec, { signal: cancel.signal })),
    ).then((settled) => {
      if (!alive) return;
      setRevalidating(false);
      // 内容一样不换(免得白闪);新结果全失败也不覆盖已有的(网络抖一下 ≠ 没有卡)
      if (entriesDiffer((cached?.entries as SceneCardEntry[] | undefined) ?? null, settled)) {
        setEntries(settled);
        const now = new Date();
        setAt(now.toISOString());
        writeSceneCardCache(key, settled, now);
      } else if (!cached) {
        writeSceneCardCache(key, settled);
        setAt(new Date().toISOString());
      }
    });
    return () => {
      alive = false;
      cancel.abort();
      setRevalidating(false);
    };
  }, [hostUrl, planKey, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { entries, at, revalidating, refresh };
}
