/**
 * 「连接 Compass」的前端调用。
 *
 * 承诺是 **贴完立刻生效**:写完凭据马上让后端同步一次,数据源和默认项目当场
 * 出来 —— 而不是让人等十分钟的周期同步,或者(像之前那样)重启应用。
 */
export type CredentialState =
  | { configured: false }
  | { configured: true; url: string; tokenMasked: string };

export async function getCompassCredential(
  fetchImpl: typeof fetch = fetch,
): Promise<CredentialState> {
  const res = await fetchImpl('/api/compass-identity/credential');
  if (!res.ok) return { configured: false };
  return (await res.json()) as CredentialState;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * 存凭据,然后立刻同步一次。
 *
 * 同步失败**不算保存失败** —— 凭据确实已经写进去了,把它报成失败会让人以为
 * 要重贴。两件事分开说。
 */
export async function saveCompassCredential(
  input: { url: string; token: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SaveResult> {
  const res = await fetchImpl('/api/compass-identity/credential', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: input.url.trim(), token: input.token.trim() }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `保存失败(HTTP ${res.status})` };
  }
  try {
    await fetchImpl('/api/compass-identity/refresh', { method: 'POST' });
  } catch {
    /* 同步失败不影响"已保存"这个事实 */
  }
  return { ok: true };
}

export async function disconnectCompass(
  fetchImpl: typeof fetch = fetch,
): Promise<SaveResult> {
  const res = await fetchImpl('/api/compass-identity/credential', { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: `断开失败(HTTP ${res.status})` };
  try {
    await fetchImpl('/api/compass-identity/refresh', { method: 'POST' });
  } catch {
    /* 同上 */
  }
  return { ok: true };
}

/**
 * 贴进来的东西能不能用 —— 在发请求**之前**给出人能看懂的话。
 *
 * 最常见的两种手滑:整段 `Bearer eyJ…` 一起复制、以及从终端复制带上了换行。
 * 前者要指出来(否则服务端只会回一个 401,人查不到这一层),后者直接替他处理掉。
 */
export function normalizeToken(raw: string): { token: string; note?: string } {
  const trimmed = raw.trim();
  const m = /^Bearer\s+(.*)$/i.exec(trimmed);
  if (m?.[1]) return { token: m[1].trim(), note: '已去掉开头的 “Bearer ”' };
  return { token: trimmed };
}

export function validateConnectInput(url: string, token: string): string | null {
  if (!url.trim()) return '请填 Compass 地址';
  if (!token.trim()) return '请贴上 token';
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return '地址解析不了,应形如 http://127.0.0.1:8000';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '地址必须以 http:// 或 https:// 开头';
  }
  return null;
}
