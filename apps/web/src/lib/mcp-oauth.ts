/**
 * 通用 MCP 授权的前端调用。
 *
 * 和 Compass 那条一样:**token 不经过前端**。这里只负责把授权页打开、问结果。
 */
export type McpAuthState = { authorized: boolean; needsAuth: boolean };

export async function getMcpAuthState(
  serverId: string,
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<McpAuthState> {
  const q = new URLSearchParams({ serverId, url });
  try {
    const res = await fetchImpl(`/api/mcp-oauth/status?${q}`);
    if (!res.ok) return { authorized: false, needsAuth: false };
    return (await res.json()) as McpAuthState;
  } catch {
    // 探不到就什么也不显示 —— 这一行是陈述,不该因为一次网络抖动冒出个按钮。
    return { authorized: false, needsAuth: false };
  }
}

export async function startMcpAuth(
  serverId: string,
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; flowId: string; authorizeUrl: string } | { ok: false; error: string }> {
  const res = await fetchImpl('/api/mcp-oauth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId, url }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    flowId?: string; authorizeUrl?: string; error?: string;
  };
  if (!res.ok || !body.flowId || !body.authorizeUrl) {
    return { ok: false, error: body.error ?? `无法开始授权(HTTP ${res.status})` };
  }
  return { ok: true, flowId: body.flowId, authorizeUrl: body.authorizeUrl };
}

export type McpFlow =
  | { status: 'pending' }
  | { status: 'done' }
  | { status: 'denied' }
  | { status: 'error'; error: string };

export async function pollMcpFlow(
  flowId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<McpFlow> {
  const res = await fetchImpl(`/api/mcp-oauth/flow?flowId=${encodeURIComponent(flowId)}`);
  if (res.status === 404) return { status: 'error', error: '这次授权已经过期,请重新开始。' };
  const body = (await res.json().catch(() => ({}))) as McpFlow;
  return body.status ? body : { status: 'error', error: '读不到授权状态' };
}

export async function revokeMcpAuth(
  serverId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await fetchImpl(`/api/mcp-oauth/credential?serverId=${encodeURIComponent(serverId)}`, {
    method: 'DELETE',
  });
}

/** 这一行该显示什么动作。**没被要求授权时什么也不显示** —— 不给用不上的按钮。 */
export function mcpAuthAction(state: McpAuthState): 'authorize' | 'revoke' | null {
  if (state.authorized) return 'revoke';
  return state.needsAuth ? 'authorize' : null;
}
