/**
 * 通用 MCP 授权:加任何一个服务器,被 401 拒了就自动找到它的登录页。
 *
 * 流程:探一下 → 401 + `WWW-Authenticate` → 发现授权服务器(mcp-oauth-discovery)
 * → 动态注册 → 授权码 + PKCE(oauth-client / 本机回调)→ token 存进这个服务器
 * 自己的凭据槽。
 *
 * **为什么值得做通用的**:否则每接一家就要特事特办一次,而且每一次特事特办的
 * 诱惑都是"先把 token 写进配置文件里" —— 我们自己的插件包就是这么长出来的
 * (`.mcp.json` 里躺着一张 role=central 的票)。凭据随包分发会被复制、会过期,
 * 过期时的表现是"工具全在、一调就 401",最难查的一类。有了这条通用路,那条路
 * 就没有存在的理由了。
 *
 * 三条自定规矩(和 Compass 那条流程一致):回调**只绑 127.0.0.1**、**一次性**、
 * **有超时**。
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { writeMcpCredential } from './mcp-credentials.js';
import { discoverAuthServer, type AuthServerEndpoints } from './mcp-oauth-discovery.js';
import { authorizeUrl, callbackPage, createPkce, createState, readCallback } from './oauth-client.js';

const FLOW_TIMEOUT_MS = 5 * 60 * 1000;
const CLIENT_NAME = 'Veylin';

export type ProbeResult =
  | { needsAuth: false }
  | { needsAuth: true; wwwAuthenticate: string | null };

/**
 * 这个服务器要不要授权。
 *
 * **只认 401**:连不上、超时、500 都不是"需要登录" —— 把它们当成需要登录,会让
 * 一个宕机的服务器不停地把用户往登录页赶。
 */
export async function probeNeedsAuth(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult> {
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (res.status !== 401) return { needsAuth: false };
    return { needsAuth: true, wwwAuthenticate: res.headers.get('www-authenticate') };
  } catch {
    return { needsAuth: false };
  }
}

async function registerClient(
  endpoints: AuthServerEndpoints,
  redirectUri: string,
  f: typeof fetch,
  givenClientId?: string,
): Promise<string> {
  // 人已经给了就直接用 —— 有些授权服务器(实测:GitHub)不支持动态注册,只能去
  // 它那边先申请一个。没有这条路的话,那类服务器就是死胡同。
  if (givenClientId) return givenClientId;
  if (!endpoints.registrationEndpoint) {
    throw new Error(
      '这个授权服务器不支持自动注册(RFC 7591)。请到它那边申请一个 OAuth 客户端,' +
      `把回调地址填成 ${new URL(redirectUri).origin.replace(/:\d+$/, '')}/callback(端口任意),` +
      '再把 client ID 填到这里。',
    );
  }
  const res = await f(endpoints.registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      // 端口运行时才知道,登记不带端口(RFC 8252 对 loopback 的规定)。
      redirect_uris: [new URL(redirectUri).origin.replace(/:\d+$/, '') + '/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  if (!res.ok) throw new Error(`向授权服务器注册客户端失败(HTTP ${res.status})`);
  const body = (await res.json()) as { client_id?: string };
  if (!body.client_id) throw new Error('授权服务器没有返回 client_id');
  return body.client_id;
}

export async function exchange(
  endpoints: AuthServerEndpoints,
  args: { clientId: string; code: string; verifier: string; redirectUri: string },
  f: typeof fetch,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const res = await f(endpoints.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      client_id: args.clientId,
      redirect_uri: args.redirectUri,
      code_verifier: args.verifier,
    }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description ?? body.error ?? `换 token 失败(HTTP ${res.status})`);
  }
  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
  };
}

export type McpFlowStatus =
  | { status: 'pending'; authorizeUrl: string }
  | { status: 'done' }
  | { status: 'denied' }
  | { status: 'error'; error: string };

type Flow = McpFlowStatus & { close: () => void };
const flows = new Map<string, Flow>();

export function getMcpFlow(id: string): McpFlowStatus | null {
  const f = flows.get(id);
  if (!f) return null;
  const { close: _c, ...rest } = f;
  return rest as McpFlowStatus;
}

function settle(id: string, next: McpFlowStatus): void {
  const f = flows.get(id);
  if (!f) return;
  flows.set(id, { ...next, close: f.close });
  f.close();
}

export type StartMcpOAuthOptions = {
  dataDir?: string;
  /** 对面不支持动态注册时,由人提供。 */
  clientId?: string;
  fetchImpl?: typeof fetch;
  wwwAuthenticate?: string | null;
  onConnected?: () => unknown | Promise<unknown>;
  timeoutMs?: number;
};

/**
 * 给某个 MCP 服务器跑一次授权。serverId 决定 token 存进哪个槽 —— 每个服务器
 * 一份,不共用:两家服务器共用一张凭据,等于把其中一家的授权也给了另一家。
 */
export async function startMcpOAuth(
  serverId: string,
  serverUrl: string,
  opts: StartMcpOAuthOptions = {},
): Promise<{ flowId: string; authorizeUrl: string }> {
  const f = opts.fetchImpl ?? fetch;
  const found = await discoverAuthServer(serverUrl, {
    wwwAuthenticate: opts.wwwAuthenticate ?? null,
    fetchImpl: f,
  });
  if (!found.ok) throw new Error(found.reason);
  const endpoints = found.endpoints;

  const { verifier, challenge } = createPkce();
  const state = createState();
  const flowId = createState();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const outcome = readCallback(url.searchParams, state);
    const reply = (title: string, detail: string) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(callbackPage(title, detail));
    };
    if (outcome.kind === 'denied') {
      reply('已取消', '你拒绝了这次授权。可以关掉这个页面。');
      settle(flowId, { status: 'denied' });
      return;
    }
    if (outcome.kind === 'error') {
      reply('没能完成', outcome.message);
      settle(flowId, { status: 'error', error: outcome.message });
      return;
    }
    void exchange(endpoints, { clientId, code: outcome.code, verifier, redirectUri }, f)
      .then(async (pair) => {
        writeMcpCredential(
          serverId,
          {
            issuer: endpoints.issuer,
            clientId,
            accessToken: pair.accessToken,
            ...(pair.refreshToken ? { refreshToken: pair.refreshToken } : {}),
          },
          opts.dataDir,
        );
        reply('连上了', '可以关掉这个页面,回到 Veylin。');
        settle(flowId, { status: 'done' });
        await opts.onConnected?.();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        reply('没能完成', message);
        settle(flowId, { status: 'error', error: message });
      });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const clientId = await registerClient(endpoints, redirectUri, f, opts.clientId).catch((err: unknown) => {
    server.close();
    throw err;
  });

  const url = authorizeUrl({
    authorizationEndpoint: endpoints.authorizationEndpoint,
    clientId,
    redirectUri,
    challenge,
    state,
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    server.close();
  };
  const timer = setTimeout(() => {
    settle(flowId, { status: 'error', error: '等了 5 分钟没有收到回调 —— 登录没有完成。' });
  }, opts.timeoutMs ?? FLOW_TIMEOUT_MS);
  timer.unref?.();

  flows.set(flowId, { status: 'pending', authorizeUrl: url, close });
  return { flowId, authorizeUrl: url };
}

export function resetMcpFlows(): void {
  for (const f of flows.values()) f.close();
  flows.clear();
}

export type Diagnosis =
  | { kind: 'ok' }
  | { kind: 'needs-auth'; detail: string }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'http-error'; detail: string };

/**
 * 一台服务器连不上,到底为什么。
 *
 * 为什么需要它:MCP 客户端库把每台服务器的连接错误**吞进了 console** ——
 * `listToolsets()` 不抛,只是安静地少返回一个。上层于是只知道"它不在里面",
 * 界面就成了"部分服务连接失败"却什么也展不开、重试也没反应(实测)。
 *
 * 与其等库把原因给我们,不如自己去问一次:401 → 需要授权(而且我们能直接给出
 * 授权入口);连不上 → 说是连不上;别的状态码 → 把数字说出来。
 */
export async function diagnoseConnection(
  url: string,
  fetchImpl: typeof fetch = fetch,
  /** 这台服务器配置里/凭据仓里的头(Authorization 等)。**不带就是误诊。** */
  auth?: { headers?: Record<string, string> },
): Promise<Diagnosis> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/event-stream',
        // **必须带上凭据。** 不带的话,任何需要凭据的服务器都回 401,于是界面
        // 常年挂着"compass 需要授权",而 compass 一直在正常用(用户反复撞到)。
        // 实测:compass 裸 GET = 401,带凭据 = 200。
        ...(auth?.headers ?? {}),
      },
    });
  } catch (err) {
    return {
      kind: 'unreachable',
      detail: `连不上这个地址(${err instanceof Error ? err.message : String(err)})—— 检查地址,或那边的服务是不是没起。`,
    };
  }
  if (res.status === 401) {
    return { kind: 'needs-auth', detail: '需要授权 —— 在这一行的菜单里点「授权」。' };
  }
  // **405/406 不是故障**:MCP 的 streamable-HTTP 端点完全可以只接 POST。
  // 把"不接受 GET"报成连接失败,是拿探测方式的局限当对方的毛病。
  if (res.ok || res.status === 405 || res.status === 406) return { kind: 'ok' };
  return { kind: 'http-error', detail: `这个地址返回 HTTP ${res.status}。` };
}
