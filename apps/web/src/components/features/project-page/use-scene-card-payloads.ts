import { useEffect, useMemo, useState } from 'react';
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
    const specs = JSON.parse(planKey) as Omit<SceneCardEntry, 'fetched'>[];
    if (specs.length === 0) {
      setEntries([]);
      return;
    }
    let alive = true;
    setEntries(null);
    void Promise.all(
      specs.map(async (spec): Promise<SceneCardEntry> => {
        try {
          const r = await fetch(hostUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              method: 'tools/call',
              params: { name: SCENE_CARD_TOOL, arguments: spec.args },
            }),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return { ...spec, fetched: { status: 'ready', result: (await r.json()) as unknown } };
        } catch {
          // One card's failure never fails the page — it renders its own
          // error line (and, being display-less, drops the page to the
          // side-by-side fallback).
          return { ...spec, fetched: { status: 'error' } };
        }
      }),
    ).then((settled) => {
      if (alive) setEntries(settled);
    });
    return () => {
      alive = false;
    };
  }, [hostUrl, planKey]);

  return entries;
}
