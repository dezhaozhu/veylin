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

/**
 * 参数用对象而不是位置参数:这里插过一个中间参数,把调用方的 fetch 挤成了
 * clientId —— 位置参数每加一个,所有旧调用都可能悄悄错位。
 */
export async function startMcpAuth(
  serverId: string,
  url: string,
  opts: {
    /** 对面不支持自动注册时(实测:GitHub),由人到那边申请后填进来。 */
    clientId?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<{ ok: true; flowId: string; authorizeUrl: string } | { ok: false; error: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl('/api/mcp-oauth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId, url, ...(opts.clientId ? { clientId: opts.clientId } : {}) }),
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

export type Diagnosis =
  | { kind: 'ok' }
  | { kind: 'needs-auth'; detail: string }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'http-error'; detail: string };

/**
 * 连不上时问一句"为什么"。
 *
 * MCP 客户端库把每台服务器的连接错误吞进了 console,上层只知道"它不在工具集里" ——
 * 界面于是只能说"部分服务连接失败",展不开、重试也没反应(实测)。这条把原因问回来。
 */
export async function diagnoseMcp(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Diagnosis | null> {
  try {
    const res = await fetchImpl(`/api/mcp-oauth/diagnose?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    return (await res.json()) as Diagnosis;
  } catch {
    return null;
  }
}

/** 一行摘要:说得出原因就说原因,说不出就说"说不出" —— 不含糊成"连接失败"。 */
export function describeDiagnosis(d: Diagnosis | null): string {
  if (!d) return '连不上,而且没问出原因';
  if (d.kind === 'ok') return '地址是通的 —— 失败可能出在握手或凭据上';
  return d.detail;
}
