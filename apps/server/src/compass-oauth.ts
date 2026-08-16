/**
 * Veylin 作为 Compass 的 OAuth 客户端(授权码 + PKCE)。
 *
 * 对应 Compass 侧 spec 2026-08-15 §2。这里是**判据**那一半:PKCE 怎么生成、
 * 授权链接怎么拼、回调回来算不算数。有状态的部分(起监听、换 token)在
 * compass-oauth-flow.ts。
 *
 * 客户端这一侧真正能自己把自己坑掉的只有两处:
 *
 * 1. **state 不校验** —— 那样任何人塞给我们的回调都会被当成自己发起的那次,
 *    别人的授权码就被我们换成了 token 并存下来(会话固定)。
 * 2. **verifier 太弱** —— PKCE 的全部安全性都在"这串东西猜不到"上。
 */
import crypto from 'node:crypto';

const b64url = (b: Buffer) => b.toString('base64url');

export type Pkce = { verifier: string; challenge: string };

/**
 * 生成 PKCE 对。verifier 用 64 字节随机 → base64url(86 字符,在 RFC 7636 的
 * 43–128 之内)。**必须是密码学随机**:可预测的 verifier 等于没有 PKCE。
 */
export function createPkce(): Pkce {
  const verifier = b64url(crypto.randomBytes(64)).slice(0, 86);
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** 一次授权尝试的随机标识。回调必须原样带回来,否则不认。 */
export function createState(): string {
  return b64url(crypto.randomBytes(24));
}

export type AuthorizeParams = {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
};

export function authorizeUrl(p: AuthorizeParams): string {
  const u = new URL(`${p.baseUrl.replace(/\/+$/, '')}/oauth/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', p.state);
  return u.toString();
}

export type CallbackOutcome =
  | { kind: 'code'; code: string }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

/**
 * 回调带回来的东西算不算数。
 *
 * **state 用定长比较** —— 这是在比一个决定"要不要接受这次授权"的秘密值;
 * 早退式比较会泄露前缀。
 */
export function readCallback(
  params: URLSearchParams,
  expectedState: string,
): CallbackOutcome {
  const state = params.get('state') ?? '';
  const sameState =
    state.length === expectedState.length &&
    crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState));
  if (!sameState) {
    // 不说"你的 state 是 X、我要的是 Y" —— 那是在帮对面对齐。
    return { kind: 'error', message: '回调的 state 对不上,已忽略(不是这次登录发起的)' };
  }
  const err = params.get('error');
  if (err === 'access_denied') return { kind: 'denied' };
  if (err) return { kind: 'error', message: `Compass 拒绝了这次授权:${err}` };
  const code = params.get('code');
  if (!code) return { kind: 'error', message: '回调里没有授权码' };
  return { kind: 'code', code };
}

/** 回调落地页 —— 用户此刻正盯着浏览器,得告诉他可以回去了。 */
export function callbackPage(title: string, detail: string): string {
  const e = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return (
    `<!doctype html><meta charset="utf-8"><title>${e(title)}</title>` +
    `<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:5rem auto;` +
    `line-height:1.6;color:#222}p{color:#666}</style>` +
    `<h1>${e(title)}</h1><p>${e(detail)}</p>`
  );
}
