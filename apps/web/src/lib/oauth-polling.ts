/**
 * 等一次浏览器授权走完 —— 并且**能被叫停**。
 *
 * 起因是实测:点开授权后内置浏览器关不掉,取消了轮询还在后台跑满五分钟。
 * 两处(Compass 那一行、通用 MCP 那一行)各写了一遍同样的循环,于是同一个 bug
 * 也有两份。抽出来一起修,顺便让它能被测到 —— 循环写在组件里是测不到的。
 *
 * 三条:
 * - **取消要立刻生效**:每一跳前后都看一眼,不能等这一轮 sleep 完。
 * - **结束一定要收尾**:调用方靠返回值关掉那个浏览器窗口,所以任何一条出口都得
 *   返回,不能有"就这么挂着"的分支。
 * - **等太久也是一种结束**,不是继续等。
 */
export type PollOutcome<S> =
  | { kind: 'settled'; status: S }
  | { kind: 'cancelled' }
  | { kind: 'timeout' };

export async function pollUntilSettled<S extends { status: string }>(opts: {
  poll: () => Promise<S>;
  isPending: (s: S) => boolean;
  onStatus?: (s: S) => void;
  isCancelled: () => boolean;
  wait?: (ms: number) => Promise<void>;
  intervalMs?: number;
  maxTicks?: number;
}): Promise<PollOutcome<S>> {
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const interval = opts.intervalMs ?? 2000;
  const max = opts.maxTicks ?? 150;

  for (let i = 0; i < max; i += 1) {
    if (opts.isCancelled()) return { kind: 'cancelled' };
    const s = await opts.poll();
    // 取消可能发生在这一跳的网络往返期间 —— 回来先再看一眼,别把结果写回界面。
    if (opts.isCancelled()) return { kind: 'cancelled' };
    opts.onStatus?.(s);
    if (!opts.isPending(s)) return { kind: 'settled', status: s };
    await wait(interval);
  }
  return { kind: 'timeout' };
}
