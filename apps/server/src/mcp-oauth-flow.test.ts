/**
 * 通用 MCP 授权的可测部分:探测、注册、换 token。
 *
 * 起真监听那段要真 socket(沙箱里连不上本机回环),靠实机验;这里钉它周围。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diagnoseConnection, exchange, probeNeedsAuth } from './mcp-oauth-flow.js';

const resp = (status: number, headers: Record<string, string> = {}, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const fake = (h: (url: string, init?: RequestInit) => Response) =>
  (async (u: string | URL | Request, init?: RequestInit) => h(String(u), init)) as unknown as typeof fetch;

describe('要不要授权', () => {
  it('401 才算要授权,并把响应头带出来', async () => {
    const out = await probeNeedsAuth('https://api.x/mcp/', fake(() =>
      resp(401, { 'WWW-Authenticate': 'Bearer resource_metadata="https://api.x/.well-known/oauth-protected-resource"' })));
    assert.equal(out.needsAuth, true);
    if (out.needsAuth) assert.match(out.wwwAuthenticate ?? '', /resource_metadata/);
  });

  it('200 当然不用', async () => {
    assert.equal((await probeNeedsAuth('https://api.x/mcp/', fake(() => resp(200)))).needsAuth, false);
  });

  it('**500 不算要授权** —— 否则一台宕机的服务器会不停把人往登录页赶', async () => {
    assert.equal((await probeNeedsAuth('https://api.x/mcp/', fake(() => resp(500)))).needsAuth, false);
  });

  it('连不上也不算 —— 同理', async () => {
    const boom = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    assert.equal((await probeNeedsAuth('https://api.x/mcp/', boom)).needsAuth, false);
  });
});

describe('换 token', () => {
  const ep = {
    issuer: 'https://as.x',
    authorizationEndpoint: 'https://as.x/authorize',
    tokenEndpoint: 'https://as.x/token',
  };
  const args = { clientId: 'cid', code: 'c', verifier: 'v'.repeat(64), redirectUri: 'http://127.0.0.1:5/callback' };

  it('打的是**元数据给的 token 端点**,不是拼出来的路径', async () => {
    let hit = '';
    const out = await exchange(ep, args, fake((u) => { hit = u; return resp(200, {}, { access_token: 'tok' }); }));
    assert.equal(hit, 'https://as.x/token');
    assert.equal(out.accessToken, 'tok');
  });

  it('带回 refresh', async () => {
    const out = await exchange(ep, args, fake(() => resp(200, {}, { access_token: 'a', refresh_token: 'r' })));
    assert.equal(out.refreshToken, 'r');
  });

  it('失败时把对面的话原样带出来', async () => {
    await assert.rejects(
      () => exchange(ep, args, fake(() => resp(400, {}, { error_description: '授权码已经用过了' }))),
      /已经用过/,
    );
  });
});

describe('不支持动态注册的服务器', () => {
  it('**报错要说得出下一步** —— 否则那类服务器就是死胡同(实测:GitHub 就不支持)', async () => {
    const { registerClientForTest } = await import('./mcp-oauth-flow.js') as never as {
      registerClientForTest?: unknown;
    };
    // 注册函数不导出,这里通过整条流程验:没有注册端点又没给 clientId → 报错带指引
    const { startMcpOAuth } = await import('./mcp-oauth-flow.js');
    const meta = {
      'https://api.x/.well-known/oauth-protected-resource': { authorization_servers: ['https://as.x'] },
      'https://as.x/.well-known/oauth-authorization-server': {
        issuer: 'https://as.x',
        authorization_endpoint: 'https://as.x/authorize',
        token_endpoint: 'https://as.x/token',
        code_challenge_methods_supported: ['S256'],
      },
    } as Record<string, unknown>;
    const f = (async (u: string | URL | Request) => {
      const b = meta[String(u)];
      return new Response(JSON.stringify(b ?? {}), { status: b ? 200 : 404 });
    }) as unknown as typeof fetch;

    await assert.rejects(
      () => startMcpOAuth('s', 'https://api.x/mcp/', { fetchImpl: f, dataDir: '/tmp' }),
      /申请一个 OAuth 客户端|client ID/,
    );
    assert.equal(registerClientForTest, undefined);
  });
});

describe('连不上时说得出为什么', () => {
  const f = (h: (u: string) => Response | Promise<Response>) =>
    (async (u: string | URL | Request) => h(String(u))) as unknown as typeof fetch;

  it('401 → 需要授权,并指向那个动作', async () => {
    const d = await diagnoseConnection('https://x/mcp', f(() => resp(401)));
    assert.equal(d.kind, 'needs-auth');
    if (d.kind === 'needs-auth') assert.match(d.detail, /授权/);
  });

  it('连不上 → 说是连不上,并给出该查什么', async () => {
    const boom = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const d = await diagnoseConnection('https://x/mcp', boom);
    assert.equal(d.kind, 'unreachable');
    if (d.kind === 'unreachable') assert.match(d.detail, /地址|服务/);
  });

  it('别的状态码 → 把数字说出来,不含糊成"失败"', async () => {
    const d = await diagnoseConnection('https://x/mcp', f(() => resp(503)));
    assert.equal(d.kind, 'http-error');
    if (d.kind === 'http-error') assert.match(d.detail, /503/);
  });

  it('能连上就是 ok —— 不给没有问题的东西编一个原因', async () => {
    assert.equal((await diagnoseConnection('https://x/mcp', f(() => resp(200)))).kind, 'ok');
  });
});

/**
 * 用户反复撞到的:界面常年挂着「部分 MCP 服务连接失败 —— compass 需要授权」,
 * 而 compass 明明一直在正常用。
 *
 * 根因:诊断那条路**不带凭据**去探,于是任何需要凭据的服务器都回 401,
 * 一律被判成"需要授权"。实测:compass 裸 GET = 401,带凭据 = 200。
 */
describe('诊断要带上这台服务器的凭据', () => {
  const mk = (status: number, seen: { headers?: Record<string, string> }) =>
    (async (_u: string | URL | Request, init?: RequestInit) => {
      seen.headers = (init?.headers ?? {}) as Record<string, string>;
      return new Response('', { status });
    }) as unknown as typeof fetch;

  it('**带上配置的 headers** —— 不带就把好服务器判成需要授权', async () => {
    const seen: { headers?: Record<string, string> } = {};
    const out = await diagnoseConnection('https://x/mcp/', mk(200, seen), {
      headers: { Authorization: 'Bearer tok' },
    });
    assert.equal(out.kind, 'ok');
    assert.equal(seen.headers!.Authorization, 'Bearer tok');
  });

  it('带了凭据还 401 → 才是真的需要授权', async () => {
    const out = await diagnoseConnection('https://x/mcp/', mk(401, {}), {
      headers: { Authorization: 'Bearer 过期了' },
    });
    assert.equal(out.kind, 'needs-auth');
  });

  it('**405/406 不是故障** —— MCP 端点本来就可以拒绝 GET,它只是不接受这个方法', async () => {
    for (const s of [405, 406]) {
      const out = await diagnoseConnection('https://x/mcp/', mk(s, {}), { headers: {} });
      assert.equal(out.kind, 'ok', `HTTP ${s} 被当成故障了`);
    }
  });

  it('没有凭据可带时照旧探 —— 行为不变', async () => {
    assert.equal((await diagnoseConnection('https://x/mcp/', mk(401, {}))).kind, 'needs-auth');
  });
});
