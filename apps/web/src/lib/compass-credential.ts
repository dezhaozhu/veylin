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

// —— 用浏览器登录(授权码 + PKCE)——————————————————————————
//
// token **不经过前端**:回调直接落到服务端进程,换完写进凭据文件。这里只负责
// 把授权页打开、然后问结果。

export type OAuthStart = { flowId: string; authorizeUrl: string };

export async function startOAuthLogin(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; start: OAuthStart } | { ok: false; error: string }> {
  const res = await fetchImpl('/api/compass-identity/oauth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url.trim() }),
  });
  const body = (await res.json().catch(() => ({}))) as OAuthStart & { error?: string };
  if (!res.ok) return { ok: false, error: body.error ?? `无法开始登录(HTTP ${res.status})` };
  return { ok: true, start: { flowId: body.flowId, authorizeUrl: body.authorizeUrl } };
}

export type OAuthStatus =
  | { status: 'pending' }
  | { status: 'done' }
  | { status: 'denied' }
  | { status: 'error'; error: string };

export async function pollOAuthStatus(
  flowId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthStatus> {
  const res = await fetchImpl(
    `/api/compass-identity/oauth/status?flowId=${encodeURIComponent(flowId)}`,
  );
  if (res.status === 404) {
    // 会话不在了 —— 多半是超时被清掉。说清楚,别显示成永远 pending。
    return { status: 'error', error: '这次登录已经过期,请重新开始。' };
  }
  const body = (await res.json().catch(() => ({}))) as OAuthStatus;
  return body.status ? body : { status: 'error', error: '读不到登录状态' };
}

/** 登录还没结束时,界面该说什么。 */
export function describeOAuthStatus(s: OAuthStatus): string {
  switch (s.status) {
    case 'pending':
      return '等你在浏览器里登录并授权…';
    case 'done':
      return '连上了';
    case 'denied':
      return '你在浏览器里拒绝了这次授权。';
    default:
      return s.error;
  }
}
