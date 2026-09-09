import { parseNavigateMessage, type NavigateTarget } from '@/lib/correction-bridge';

/**
 * agent 调了 `navigate` 工具之后,客户端要不要真的动右栏。
 *
 * 工具结果会随对话历史一起**反复渲染**(回看旧线程、切换线程、React 重挂),
 * 每次都拉开右栏定位一次,人会以为界面疯了。所以只对**刚发出**的结果动作:
 *  · issued_at 在 FRESH_MS 之内(服务端盖的发出时刻,不信客户端时钟以外的东西);
 *  · 这条 toolCallId 本会话没动过(同一条结果 StrictMode/重挂会渲染多次)。
 * 形状校验复用卡片那条路的 parseNavigateMessage —— 两个入口一套判据。
 */
export const NAVIGATE_FRESH_MS = 30_000;
/** 两次自动导航之间的最小间隔:提示词说「一轮最多一次」,这里是兜底 —— 模型连调两次也只动一次右栏。 */
export const NAVIGATE_MIN_GAP_MS = 8_000;

export function shouldFireNavigate(
  result: unknown,
  toolCallId: string,
  opts: { now: number; seen: Set<string>; lastFiredAt?: { value: number } },
): NavigateTarget | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as { ok?: unknown; anchor?: unknown; surface?: unknown; issued_at?: unknown };
  if (r.ok !== true) return null;
  if (typeof r.issued_at !== 'number' || opts.now - r.issued_at > NAVIGATE_FRESH_MS || r.issued_at > opts.now + 5_000) {
    return null;
  }
  if (opts.seen.has(toolCallId)) return null;
  const target = parseNavigateMessage({
    type: 'veylin:action',
    action: 'navigate',
    payload: { anchor: r.anchor, surface: r.surface },
  });
  if (!target) return null;
  if (opts.lastFiredAt && opts.now - opts.lastFiredAt.value < NAVIGATE_MIN_GAP_MS) {
    opts.seen.add(toolCallId);   // 记成已见:这条就算过了,不会等一会又冒出来
    return null;
  }
  opts.seen.add(toolCallId);
  if (opts.lastFiredAt) opts.lastFiredAt.value = opts.now;
  return target;
}
