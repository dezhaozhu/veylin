/**
 * 通用 MCP 授权的路由:探一下要不要登录、开始登录、问结果、撤销。
 *
 * 和 Compass 那条一样:**token 不经过前端** —— 回调直接落到这个进程,换完写进
 * 那个服务器自己的凭据槽。
 */
import type { FastifyInstance } from 'fastify';

import { clearMcpCredential, hasMcpCredential } from '../mcp-credentials.js';
import { getMcpFlow, probeNeedsAuth, startMcpOAuth } from '../mcp-oauth-flow.js';

export type McpOAuthDeps = { dataDir?: () => string | undefined };

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
