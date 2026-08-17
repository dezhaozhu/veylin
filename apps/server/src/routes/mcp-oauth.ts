/**
 * 通用 MCP 授权的路由:探一下要不要登录、开始登录、问结果、撤销。
 *
 * 和 Compass 那条一样:**token 不经过前端** —— 回调直接落到这个进程,换完写进
 * 那个服务器自己的凭据槽。
 */
import type { FastifyInstance } from 'fastify';

import { clearMcpCredential, hasMcpCredential } from '../mcp-credentials.js';
import { listRemoteMcpServers } from '../mcp-store.js';
import { readMcpCredential } from '../mcp-credentials.js';
import {
  diagnoseConnection,
  getMcpFlow,
  probeNeedsAuth,
  startMcpOAuth,
} from '../mcp-oauth-flow.js';

export type McpOAuthDeps = {
  dataDir?: () => string | undefined;
  /** 解析租户 —— 诊断要按租户去查这台服务器配了什么头(Authorization 等)。 */
  resolveContext?: (headers: never) => Promise<{ tenantId: string }>;
};

export function registerMcpOAuthRoutes(app: FastifyInstance, deps: McpOAuthDeps = {}): void {
  const dir = () => deps.dataDir?.();

  app.get('/api/mcp-oauth/status', async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const serverId = q.serverId ?? '';
    const url = q.url ?? '';
    const authorized = serverId ? hasMcpCredential(serverId, dir()) : false;
    // 已经授权过就不去探 —— 那一次探测毫无必要,还会给对面平白多一次 401。
    if (authorized || !url) return { authorized, needsAuth: false };
    const probe = await probeNeedsAuth(url);
    return { authorized, needsAuth: probe.needsAuth };
  });

  // 连不上时"为什么" —— MCP 客户端库把每台服务器的错误吞进 console,上层只知道
  // "它不在工具集里"。界面据此才有话可说,而不是一句展不开的"连接失败"。
  app.get('/api/mcp-oauth/diagnose', async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const url = q.url ?? '';
    const serverId = q.serverId ?? '';
    if (!url) return reply.code(400).send({ error: '缺少 url' });

    // **带上这台服务器的凭据再探。** 不带的话任何需要凭据的服务器都回 401,
    // 界面就常年挂着"compass 需要授权" —— 而 compass 一直在正常用(用户反复撞到)。
    // 两个来源:登记里配的 headers(compass 的 token 在这儿),以及 OAuth 凭据仓
    // (走 MCP OAuth 的那些服务器在这儿)。
    const headers: Record<string, string> = {};
    if (serverId) {
      try {
        const ctx = await deps.resolveContext?.(req.headers as never);
        const server = ctx
          ? (await listRemoteMcpServers(ctx.tenantId)).find((s) => s.name === serverId)
          : undefined;
        Object.assign(headers, server?.headers ?? {});
      } catch {
        // 取不到登记不影响探测本身 —— 顶多退回"没带凭据"的老行为。
      }
      const cred = readMcpCredential(serverId, dir());
      if (cred?.accessToken) headers.Authorization = `Bearer ${cred.accessToken}`;
    }
    return diagnoseConnection(url, fetch, { headers });
  });

  app.post('/api/mcp-oauth/start', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const serverId = typeof body.serverId === 'string' ? body.serverId : '';
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    if (!serverId || !url) return reply.code(400).send({ error: '缺少 serverId 或 url' });
    const probe = await probeNeedsAuth(url);
    try {
      const out = await startMcpOAuth(serverId, url, {
        dataDir: dir(),
        ...(clientId ? { clientId } : {}),
        wwwAuthenticate: probe.needsAuth ? probe.wwwAuthenticate : null,
      });
      return out;
    } catch (err) {
      // 发现失败的原因是这条路上唯一能查下去的线索(不支持 PKCE、被指到别的站点、
      // 不支持动态注册…),原样带出来。
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/mcp-oauth/flow', async (req, reply) => {
    const flowId = ((req.query ?? {}) as Record<string, string>).flowId ?? '';
    const flow = getMcpFlow(flowId);
    if (!flow) return reply.code(404).send({ error: '没有这次登录(可能已经超时)' });
    return flow;
  });

  app.delete('/api/mcp-oauth/credential', async (req) => {
    const serverId = ((req.query ?? {}) as Record<string, string>).serverId ?? '';
    // 撤销是一个**想要的状态**:本来就没有也算达成。
    if (serverId) clearMcpCredential(serverId, dir());
    return { ok: true };
  });
}
