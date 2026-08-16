/**
 * 远程 MCP 条目要不要授权、授权走到哪一步了。
 *
 * 只探**远程**条目:本地 stdio 的插件/内置服务器没有 401 这回事,去探它们只是
 * 白白发请求。已经授权过的也不探 —— 那一次探测毫无必要,还会给对面平白多一次 401。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getMcpAuthState,
  mcpAuthAction,
  pollMcpFlow,
  revokeMcpAuth,
  startMcpAuth,
  type McpAuthState,
} from '@/lib/mcp-oauth';
import { pollUntilSettled } from '@/lib/oauth-polling';
import { closeWebView, openWebView } from '@/lib/tauri-web-view';

export type AuthAction = 'authorize' | 'revoke' | null;

const LOGIN_TAB = 'mcp-login';

export type McpAuthController = {
  actionFor: (id: string) => AuthAction;
  busyId: string | null;
  message: string | null;
  authorize: (id: string, url: string) => Promise<void>;
  revoke: (id: string) => Promise<void>;
  /** 中止正在进行的那次授权,并关掉浏览器窗口。 */
  cancel: () => void;
};

export function useMcpAuth(
  remotes: Array<{ id: string; url: string }>,
  onChanged?: () => void,
): McpAuthController {
  const [states, setStates] = useState<Record<string, McpAuthState>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // 同 Compass 那一行:取消要立刻生效,所以用 ref 而不是 state。
  const cancelled = useRef(false);

  const key = remotes.map((r) => `${r.id}|${r.url}`).join(',');
  const refresh = useCallback(async () => {
    const entries = await Promise.all(
      remotes.map(async (r) => [r.id, await getMcpAuthState(r.id, r.url)] as const),
    );
    setStates(Object.fromEntries(entries));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { void refresh(); }, [refresh]);

  const authorize = async (id: string, url: string) => {
    setBusyId(id);
    setMessage(null);
    const started = await startMcpAuth(id, url);
    if (!started.ok) { setBusyId(null); setMessage(started.error); return; }
    cancelled.current = false;
    try {
      await openWebView(LOGIN_TAB, started.authorizeUrl);
    } catch {
      setMessage(`在浏览器里打开这个地址完成授权:${started.authorizeUrl}`);
    }
    const out = await pollUntilSettled({
      poll: () => pollMcpFlow(started.flowId),
      isPending: (s) => s.status === 'pending',
      isCancelled: () => cancelled.current,
    });
    setBusyId(null);
    if (out.kind === 'cancelled') return;
    // 任何一条出口都要关掉那个浏览器窗口 —— 实测里它关不掉。
    void closeWebView(LOGIN_TAB).catch(() => {});
    if (out.kind === 'timeout') { setMessage('等太久了,没有收到授权结果。可以重试。'); return; }
    if (out.status.status === 'done') { setMessage(null); await refresh(); onChanged?.(); return; }
    if (out.status.status === 'denied') { setMessage('你在浏览器里拒绝了这次授权。'); return; }
    if (out.status.status === 'error') setMessage(out.status.error);
  };

  const revoke = async (id: string) => {
    setBusyId(id);
    await revokeMcpAuth(id);
    setBusyId(null);
    await refresh();
    onChanged?.();
  };

  return {
    actionFor: (id) => (states[id] ? mcpAuthAction(states[id]!) : null),
    busyId,
    message,
    authorize,
    revoke,
    cancel: () => {
      cancelled.current = true;
      void closeWebView(LOGIN_TAB).catch(() => {});
      setBusyId(null);
      setMessage(null);
    },
  };
}
