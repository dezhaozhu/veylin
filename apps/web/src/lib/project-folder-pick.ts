/**
 * 选文件夹:原生面板是**便利**,不是依赖。
 *
 * 实测桌面端点「选择文件夹」会把整个应用卡住 —— `open({directory:true})` 那个
 * promise 永远不落地(权限齐全,`dialog:default` 含 `allow-open`,所以不是被拒)。
 * 界面不能把可用性押在一个可能永不 settle 的调用上,于是:
 *
 *  1. 永远保留一条**不依赖原生面板**的路 —— 把路径粘进来(访达 ⌘⌥C 就是复制路径);
 *  2. 原生面板加超时,超时就明说"没响应,直接粘路径",而不是一直转圈。
 */
export type PickResult =
  | { status: 'picked'; path: string }
  | { status: 'cancelled' }
  | { status: 'timeout' }
  | { status: 'unavailable' };

export async function pickWithTimeout(
  open: () => Promise<string | null>,
  timeoutMs = 15_000,
): Promise<PickResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PickResult>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
  });
  const attempt = open()
    .then((p): PickResult => (p ? { status: 'picked', path: p } : { status: 'cancelled' }))
    .catch((): PickResult => ({ status: 'unavailable' }));
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 手动粘进来的路径要能用:访达复制带引号、终端拖拽带转义空格、某些应用给的是
 * `file://` —— 这些都别让用户自己收拾。
 */
export function normalizeTypedPath(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  if (s.startsWith('file://')) {
    try {
      s = decodeURIComponent(s.slice('file://'.length));
    } catch {
      s = s.slice('file://'.length);
    }
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  s = s.replace(/\\ /g, ' ').trim();
  if (s.length > 1 && s.endsWith('/')) s = s.replace(/\/+$/, '');
  return s;
}
