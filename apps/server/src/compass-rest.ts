/**
 * Direct REST fetches to Compass's data-plane endpoints (/data/*) — bulk rows
 * bypass the MCP tool channel (spec 2026-08-06 三形态 §2 ①). Headers carry the
 * SAME identity the MCP connection uses: the account bearer token plus
 * x-compass-source composed from the pinned project's scene set.
 */

import { explain401 } from './compass-identity.js';

export type CompassRestScope = { baseUrl: string; headers: Record<string, string> };

/** MCP entry url (`…/mcp/`) → REST base (`…`). */
export function compassRestBase(entryUrl: string): string {
  return entryUrl.replace(/\/mcp\/?$/, '').replace(/\/+$/, '');
}

export type CompassDataResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

/** 30k 行全量拉取参照 /ui/grid/data 的 120s 探针口径 (compass scripts/smoke_grid.py)。 */
const BULK_FETCH_TIMEOUT_MS = 120_000;

export async function fetchCompassData(
  rest: CompassRestScope,
  path: string,
  params: Record<string, string | number | undefined>,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<CompassDataResult> {
  const f = opts.fetchImpl ?? fetch;
  const url = new URL(`${rest.baseUrl}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? BULK_FETCH_TIMEOUT_MS);
  try {
    const res = await f(url, { headers: rest.headers, signal: controller.signal });
    if (!res.ok) {
      // 401 单独解释,和身份那条走同一个解释器:同一张过期 token 会让 /my/sources
      // 和 /data/* 一起 401,两边给的话不一样就等于让人排查两遍。
      const bearer = rest.headers.Authorization?.replace(/^Bearer\s+/i, '');
      if (res.status === 401 && bearer) {
        return { ok: false, error: `Compass 拒绝了这个身份:${explain401(bearer)}` };
      }
      return { ok: false, error: `GET ${path} returned HTTP ${res.status}` };
    }
    const body = (await res.json()) as unknown;
    if (body == null || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, error: `GET ${path} returned a non-object body` };
    }
    return { ok: true, payload: body as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
