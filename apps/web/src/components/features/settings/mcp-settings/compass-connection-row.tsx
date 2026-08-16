/**
 * MCP 设置里的 Compass 一行:连到哪、以谁的身份。
 *
 * 为什么在这里而不在项目页(用户指出的):添加服务器和授权都是**应用级**的事,
 * 放进项目就等于每建一个项目都把同一件全局的事再问一遍;而项目标题下面本来就
 * 已经写着它用的数据源了。
 *
 * **各种状态只占这一行**:没连接、连上了、连不上 —— 同一行换措辞换动作,而不是
 * 多出几行状态提示(一个事实一处表达)。
 */
import { useCallback, useEffect, useState, type FC } from 'react';

import {
  compassActionLabel,
  describeCompassRow,
  type WhoAmI,
} from '@/lib/compass-connection';
import {
  describeOAuthStatus,
  disconnectCompass,
  normalizeToken,
  pollOAuthStatus,
  saveCompassCredential,
  startOAuthLogin,
  validateConnectInput,
} from '@/lib/compass-credential';
import { openWebView } from '@/lib/tauri-web-view';
import { SettingsListRow } from '@/components/features/settings/settings-list';

/** 身份取一次,放在屏幕层 —— 分区(未连接归 Library、连上归 Connected)和计数都
 *  要用它,散在子组件里就会出现"Connected 1 但其实没连上"这种小谎。 */
export function useCompassIdentity(): { who: WhoAmI | null; reload: () => Promise<void> } {
  const [who, setWho] = useState<WhoAmI | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/compass-identity/whoami');
      setWho((await res.json()) as WhoAmI);
    } catch {
      /* 取不到就当没连接 —— 这一行是陈述,不该报错打断人 */
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { who, reload };
}

export const CompassConnectionRow: FC<{
  who: WhoAmI | null;
  onChanged?: () => void;
}> = ({ who, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('http://127.0.0.1:8000');
  const [token, setToken] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flow, setFlow] = useState<string | null>(null);

  const finish = async () => {
    setOpen(false);
    setFlow(null);
    setError(null);
    onChanged?.();
  };

  const browserLogin = async () => {
    const bad = validateConnectInput(url, 'placeholder');
    if (bad) { setError(bad); return; }
    setError(null);
    setBusy(true);
    const started = await startOAuthLogin(url);
    if (!started.ok) { setBusy(false); setError(started.error); return; }
    try {
      await openWebView('compass-login', started.start.authorizeUrl);
    } catch {
      // 非桌面端开不了内置视图 —— 把链接给他,别让流程卡死。
      setFlow(`在浏览器里打开这个地址完成登录:${started.start.authorizeUrl}`);
    }
    for (let i = 0; i < 150; i += 1) {
      const s = await pollOAuthStatus(started.start.flowId);
      setFlow(describeOAuthStatus(s));
      if (s.status !== 'pending') {
        setBusy(false);
        if (s.status === 'done') await finish();
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    setBusy(false);
    setFlow('等太久了,没有收到授权结果。可以重试。');
  };

  const pasteConnect = async () => {
    const bad = validateConnectInput(url, token);
    if (bad) { setError(bad); return; }
    setBusy(true);
    const res = await saveCompassCredential({ url, token });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setToken('');
    await finish();
  };

  const disconnect = async () => {
    setBusy(true);
    await disconnectCompass();
    setBusy(false);
    await finish();
  };

  const state = describeCompassRow(who);

  return (
    <>
      <SettingsListRow
        icon={
          <span
            className={`inline-block size-2 rounded-full ${
              who?.configured && !who.error ? 'bg-emerald-500' : 'bg-muted-foreground/40'
            }`}
          />
        }
        title="Compass"
        subtitle={state.subtitle}
        subtitleClamp={2}
        menuItems={
          who?.configured
            ? [
                { label: '更换身份', onClick: () => setOpen(true) },
                { label: '断开', onClick: () => void disconnect(), destructive: true },
              ]
            : undefined
        }
        trailing={
          who?.configured ? null : (
            <button
              type="button"
              className="hover:bg-muted rounded-md border px-2 py-1 text-xs"
              onClick={() => setOpen(true)}
            >
              {compassActionLabel(state.action)}
            </button>
          )
        }
      />

      {open ? (
        <div className="border-border mb-2 rounded-md border px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="border-input h-7 w-64 rounded border px-2"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://127.0.0.1:8000"
            />
            <button className="underline" disabled={busy} onClick={() => void browserLogin()}>
              {busy ? '进行中…' : '用浏览器登录'}
            </button>
            <button
              className="text-muted-foreground underline"
              onClick={() => { setOpen(false); setError(null); setFlow(null); }}
            >
              取消
            </button>
          </div>
          {flow ? <p className="text-muted-foreground mt-1">{flow}</p> : null}
          {/* 备选:对面 Compass 版本旧、没有 /oauth/* 时,这是唯一的路。 */}
          <details className="mt-2">
            <summary className="text-muted-foreground cursor-pointer">或者粘贴一张 token</summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                className="border-input h-7 w-72 rounded border px-2"
                value={token}
                onChange={(e) => {
                  const out = normalizeToken(e.target.value);
                  setToken(out.token);
                  setNote(out.note ?? null);
                }}
                placeholder="粘贴 token"
              />
              <button className="underline" disabled={busy} onClick={() => void pasteConnect()}>
                连接
              </button>
            </div>
            {note ? <p className="text-muted-foreground mt-1">{note}</p> : null}
          </details>
          {error ? <p className="text-destructive mt-1">{error}</p> : null}
          <p className="text-muted-foreground mt-1">
            连接后立刻生效,不用重启。凭据存在本机数据目录(仅本人可读)。
          </p>
        </div>
      ) : null}
    </>
  );
};
