import { useEffect, useMemo, useState } from 'react';
import { mergeAbortSignals } from '@/lib/transport-reconnect';
import { SCENE_CARD_TOOL, sceneCardArgs, type SceneCardColumn } from './scene-card-grid';

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

export function useSceneCardPayloads(
  hostUrl: string,
  columns: readonly SceneCardColumn[],
  sources: readonly string[],
): SceneCardEntry[] | null {
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

  useEffect(() => {
    const specs = JSON.parse(planKey) as SceneCardSpec[];
    if (specs.length === 0) {
      setEntries([]);
      return;
    }
    let alive = true;
    // The old cleanup only guarded setState; the requests themselves kept
    // running (and holding a connection) after the view closed. Cancel them.
    const cancel = new AbortController();
    setEntries(null);
    void Promise.all(
      specs.map((spec) => fetchSceneCard(hostUrl, spec, { signal: cancel.signal })),
    ).then((settled) => {
      if (alive) setEntries(settled);
    });
    return () => {
      alive = false;
      cancel.abort();
    };
  }, [hostUrl, planKey]);

  return entries;
}
