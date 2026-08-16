/**
 * 走完一次 OAuth:注册客户端 → 起本机回调监听 → 拿码 → 换 token → 存凭据。
 *
 * 判据那一半在 compass-oauth.ts。这里是有状态的部分。
 *
 * 几条自定规矩:
 * - 回调监听**只绑 127.0.0.1**,不绑 0.0.0.0。绑全网卡意味着同网段的任何人都能
 *   往我们的回调塞东西;state 校验挡得住,但没有理由先把门打开。
 * - **一次性**:收到第一个回调就关掉。留着监听 = 留着一个谁都能连的本地端口。
 * - **有超时**:用户可能就是没去点。超时要说"没等到",而不是无限挂着。
 * - 客户端注册结果按 Compass 地址缓存 —— 每次登录都注册一个新客户端,会在对面
 *   堆出一串一次性客户端,而且台账上看不出哪个是活的。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { ensureDataDir } from '@veylin/db';

import { writeCompassCredential } from './compass-credential.js';
import {
  authorizeUrl,
  callbackPage,
  createPkce,
  createState,
  readCallback,
} from './compass-oauth.js';

const CLIENT_FILE = 'compass-oauth-client.json';
/** 用户要去浏览器里登录 —— 给足时间,但不是无限。 */
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;
const CLIENT_NAME = 'Veylin';

export type ClientRegistration = { clientId: string; baseUrl: string };

function clientFilePath(dataDir?: string): string {
  return path.join(dataDir ?? ensureDataDir(), CLIENT_FILE);
}

export function readClientRegistration(
  baseUrl: string,
  dataDir?: string,
): ClientRegistration | null {
  try {
    const all = JSON.parse(fs.readFileSync(clientFilePath(dataDir), 'utf8')) as Record<
      string,
      string
    >;
    const clientId = all[baseUrl];
    return clientId ? { clientId, baseUrl } : null;
  } catch {
    return null;
  }
}

export function writeClientRegistration(reg: ClientRegistration, dataDir?: string): void {
  const file = clientFilePath(dataDir);
  let all: Record<string, string> = {};
  try {
    all = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
  } catch {
    /* 第一次,或者文件坏了 —— 重建即可,里面没有不可再生的东西 */
  }
  all[reg.baseUrl] = reg.clientId;
  fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
}

/**
 * 拿到这个 Compass 上的 client_id(有就复用,没有才注册)。
 *
 * 登记的回调是**不带端口**的 `http://127.0.0.1/callback` —— 端口要到运行时才
 * 知道(挑一个空闲的),Compass 侧对 loopback 正是按"端口不参与匹配"来判的。
 */
export async function ensureClient(
  baseUrl: string,
  opts: { dataDir?: string; fetchImpl?: typeof fetch } = {},
): Promise<ClientRegistration> {
  const cached = readClientRegistration(baseUrl, opts.dataDir);
  if (cached) return cached;
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${baseUrl}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: ['http://127.0.0.1/callback'],
    }),
  });
  if (!res.ok) {
    throw new Error(`向 ${baseUrl} 注册客户端失败(HTTP ${res.status})`);
  }
  const body = (await res.json()) as { client_id?: string };
  if (!body.client_id) throw new Error('Compass 没有返回 client_id');
  const reg = { clientId: body.client_id, baseUrl };
  writeClientRegistration(reg, opts.dataDir);
  return reg;
}

export async function exchangeCode(
  args: { baseUrl: string; clientId: string; code: string; verifier: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const res = await fetchImpl(`${args.baseUrl}/oauth/token`, {
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
    // 把对面的话原样带出来:换 token 失败的原因(码过期、对不上)只有它知道。
    throw new Error(body.error_description ?? body.error ?? `换 token 失败(HTTP ${res.status})`);
  }
  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
  };
}

export type FlowStatus =
  | { status: 'pending'; authorizeUrl: string }
  | { status: 'done' }
  | { status: 'denied' }
  | { status: 'error'; error: string };

type Flow = FlowStatus & { close: () => void };

const flows = new Map<string, Flow>();

export function getFlow(id: string): FlowStatus | null {
  const f = flows.get(id);
  if (!f) return null;
  const { close: _close, ...rest } = f;
  return rest as FlowStatus;
}

function settle(id: string, next: FlowStatus): void {
  const f = flows.get(id);
  if (!f) return;
  flows.set(id, { ...next, close: f.close });
  f.close();
}

export type StartOptions = {
  dataDir?: string;
  fetchImpl?: typeof fetch;
  onConnected?: () => unknown | Promise<unknown>;
  timeoutMs?: number;
};

/**
 * 起一次登录。返回给前端的是 authorizeUrl(前端负责在内置浏览器里打开它)和
 * 一个 flow id(用来轮询结果)。
 *
 * token **不经过前端** —— 回调直接落到这个进程里,换完就写进凭据文件。让它在
 * 浏览器和前端之间过一道,只是多了几个它可能泄露的地方。
 */
export async function startOAuthFlow(
  baseUrl: string,
  opts: StartOptions = {},
): Promise<{ flowId: string; authorizeUrl: string }> {
  const base = baseUrl.replace(/\/+$/, '');
  const reg = await ensureClient(base, { dataDir: opts.dataDir, fetchImpl: opts.fetchImpl });
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
    void exchangeCode(
      { baseUrl: base, clientId: reg.clientId, code: outcome.code, verifier, redirectUri },
      opts.fetchImpl ?? fetch,
    )
      .then(async (pair) => {
        writeCompassCredential(
          {
            url: base,
            token: pair.accessToken,
            // 续期票必须存:漏存等于下次到期只能重新登录,而 OAuth 的意义
            // 一半就在于此。
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

  // 只绑本机回环:绑 0.0.0.0 会让同网段的任何人都能往回调塞东西。
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const url = authorizeUrl({ baseUrl: base, clientId: reg.clientId, redirectUri, challenge, state });

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

/** 测试用:清掉进程内的会话表。 */
export function resetFlows(): void {
  for (const f of flows.values()) f.close();
  flows.clear();
}
