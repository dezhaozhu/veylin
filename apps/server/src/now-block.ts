/**
 * **告诉模型现在几点。**
 *
 * 不给的话,"今天"只能落回它训练时的先验:用户实测里它把今天写成 2025-01-09,
 * 而真实日期是 2026-08-17 —— 那一列日期整列都是错的,且看不出错在哪。
 * 业内做法就是每一轮把当前时间注进系统提示(时间会变,所以这一块不能缓存)。
 *
 * 用**用户本地时区**,不是服务端 UTC:排产、交期、"明天早上"全是本地语义。
 */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function formatNowBlock(now: Date, timeZone?: string): string {
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'short',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const weekday = WEEKDAYS[Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
      .format(now)
      .replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/, (m) =>
        String(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(m)),
      ),
  )] ?? '';

  return [
    '# 当前时间',
    `${date}(${weekday})${get('hour')}:${get('minute')},时区 ${tz}。`,
    '用户说"今天/明天/这周"以此为准;**不要用你训练时以为的日期**。',
  ].join('\n');
}
