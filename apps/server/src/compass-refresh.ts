/**
 * 到期前自动换一张 access token,用户不该每 7 天被踢回登录页。
 *
 * 两条自定规矩:
 *
 * - **没到该续的时候不要续。** 每次都续等于把轮换变成高频操作 —— 而轮换那一侧
 *   带着重用检测,频繁并发只会更容易被自己绊到。
 * - **续失败不清凭据。** 网络抖一下就退出登录,是拿"暂时不通"冒充"你被登出了"。
 *   即使对面明确说这张续期凭据不能用了,也只是把话说出来,由用户决定要不要断开 ——
 *   我们替他删掉的那一下,他既看不见也撤不回。
 */
import { readCompassCredential, writeCompassCredential } from './compass-credential.js';

/** 剩下不到两天就换。7 天有效期下,这留了 ~288 次十分钟同步的机会去完成它。 */
const REFRESH_WHEN_LEFT_MS = 2 * 24 * 60 * 60 * 1000;

function expiryOf(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: number;
    };
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** 读不出 exp 的一律不续 —— 不去猜别人的凭据什么时候到期。 */
export function needsRefresh(token: string, now = Date.now()): boolean {
  const exp = expiryOf(token);
  if (exp === null) return false;
  return exp - now < REFRESH_WHEN_LEFT_MS;
}

export type RefreshOutcome =
  | 'refreshed'
  | 'not-needed'
  /** 没凭据、或这份凭据是手贴的(没有 refresh)—— 不是错误。 */
  | 'not-possible'
  /** 暂时性失败(网络/对面挂了)。凭据原样留着。 */
  | 'failed'
  /** 对面明确说续不了 —— 要重新登录。凭据仍然留着,由用户决定。 */
  | 'needs-login';

export type RefreshOptions = {
  dataDir?: string;
  clientId: string;
  fetchImpl?: typeof fetch;
  now?: number;
};

export async function refreshIfNeeded(opts: RefreshOptions): Promise<RefreshOutcome> {
  const cred = readCompassCredential(opts.dataDir);
  if (!cred?.refreshToken) return 'not-possible';
  if (!needsRefresh(cred.token, opts.now)) return 'not-needed';

  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${cred.url}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: cred.refreshToken,
        client_id: opts.clientId,
      }).toString(),
    });
  } catch {
    return 'failed';
  }
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!res.ok) return 'needs-login';
  if (!body.access_token) return 'failed';
  writeCompassCredential(
    {
      url: cred.url,
      token: body.access_token,
      // 轮换出的新票要存下来:旧的那张已经作废,漏存就等于下次续期必然失败,
      // 而且会被对面读成"重用",连累整条链。
      ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    },
    opts.dataDir,
  );
  return 'refreshed';
}
