/**
 * **迟到的响应不许盖住当前这张表。**
 *
 * 用户实测「开发组件点不动」,服务端日志把过程说得很清楚:
 *   08:12:49  sheet=…~开发组件     ← 点击,请求真发出去了
 *   08:12:50  sheet=…~sheet_1     ← 一秒后又拉了上一张表
 *
 * 每次切表都会重建 SSE 连接,旧连接的 onopen 迟到一步,用**过期的闭包**再拉一次
 * 上一张表;而 applyPayload 不看"这份数据是哪张表的"就往格子里灌 —— 于是你点了
 * 开发组件,屏幕上却是 Sheet 1 的空表,看起来就像"点不动"。
 *
 * 响应本来就带着 `sheet` 字段,一句话就能对上;缺字段时照收,免得误伤老响应。
 */
export function shouldApplyPayload(
  payloadSheet: string | undefined,
  activeSheetId: string | undefined,
): boolean {
  if (!payloadSheet || !activeSheetId) return true;
  return payloadSheet === activeSheetId;
}
