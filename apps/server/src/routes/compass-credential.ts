/**
 * 「连接 Compass」:设置 / 查看 / 断开凭据。
 *
 * 存在的理由是一次真实故障:凭据在 `.env` 里、进程启动时读一次,换了之后 401
 * 照旧,而人完全看不出原因。所以这条路由的核心承诺是 **贴完不重启就生效**
 * (见 ../compass-credential.ts)。
 *
 * token 只进不出:GET 只回遮过的形态。留头尾是有用的 —— 配错凭据时人最需要
 * 回答的正是"界面上这张是不是我刚贴的那张"。
 */
import type { FastifyInstance } from 'fastify';

import { getFlow, startOAuthFlow } from '../compass-oauth-flow.js';
import {
  clearCompassCredential,
  maskToken,
  readCompassCredential,
  writeCompassCredential,
} from '../compass-credential.js';

export type CompassCredentialDeps = {
  /** 测试注入用;生产走 ensureDataDir()。 */
  dataDir?: () => string | undefined;
  /** 连上之后立刻同步一次 —— 数据源和默认项目当场出来。 */
  syncCompassIdentity?: () => Promise<unknown>;
};

export function registerCompassCredentialRoutes(
  app: FastifyInstance,
  deps: CompassCredentialDeps = {},
): void {
  const dir = () => deps.dataDir?.();

  app.get('/api/compass-identity/credential', async () => {
    const cred = readCompassCredential(dir());
    if (!cred) return { configured: false };
    return { configured: true, url: cred.url, tokenMasked: maskToken(cred.token) };
  });

  app.put('/api/compass-identity/credential', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!url) return reply.code(400).send({ error: '缺少 url' });
    if (!token) return reply.code(400).send({ error: '缺少 token' });
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return reply.code(400).send({ error: `url 解析不了: ${url}` });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      // 凭据是要被发出去的东西 —— 别让它发去一个奇怪的协议。
      return reply.code(400).send({ error: `url 必须是 http(s): ${parsed.protocol}` });
    }
    writeCompassCredential({ url, token }, dir());
    return { ok: true };
  });

  // —— 用浏览器登录(授权码 + PKCE)————————————————————————
  //
  // token **不经过前端**:回调直接落到服务端进程,换完就写进凭据文件。让它在
  // 浏览器和前端之间过一道,只是多了几个它可能泄露的地方。前端只拿到一个
  // authorizeUrl(去内置浏览器里打开)和一个 flowId(用来问结果)。
  app.post('/api/compass-identity/oauth/start', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) return reply.code(400).send({ error: '缺少 url' });
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return reply.code(400).send({ error: `url 必须是 http(s): ${parsed.protocol}` });
      }
    } catch {
      return reply.code(400).send({ error: `url 解析不了: ${url}` });
    }
    try {
      const out = await startOAuthFlow(url, {
        dataDir: dir(),
        onConnected: deps.syncCompassIdentity,
      });
      return out;
    } catch (err) {
      // 注册不上多半是地址写错或那台 Compass 版本旧(没有 /oauth/register)——
      // 把原话带出来,别只回一个 500。
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/compass-identity/oauth/status', async (req, reply) => {
    const flowId = (req.query as Record<string, string>)?.flowId ?? '';
    const flow = getFlow(flowId);
    if (!flow) return reply.code(404).send({ error: '没有这次登录(可能已经超时)' });
    return flow;
  });

  app.delete('/api/compass-identity/credential', async () => {
    // 断开是一个**想要的状态**,不是一次操作:本来就没有也算达成,不报错。
    clearCompassCredential(dir());
    return { ok: true };
  });
}
