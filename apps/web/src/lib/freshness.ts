/**
 * 缓存要能说出自己有多旧。
 *
 * 连接器(Compass)拉来的表是**会腐烂的缓存**;`loadedAt` 一直在存,却从没露过脸。
 * 措辞照「诚实要用人话」那条:说"3 小时前刷新",不摆时间戳;**太旧的直接说它旧**,
 * 因为拿一周前的排产当依据正是这条线一路在防的事。
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** 超过这个就不只是报个数,要明说"可能已经过时"。 */
const STALE_AFTER = 3 * DAY;

export function describeFreshness(loadedAt: string | undefined | null, now = new Date()): string {
  if (!loadedAt) return '刷新时间不详';
  const t = Date.parse(loadedAt);
  if (!Number.isFinite(t)) return '刷新时间不详';

  const age = Math.max(0, now.getTime() - t);   // 时钟不齐时不显示负数
  const stale = age >= STALE_AFTER;

  if (age < MINUTE) return '刚刚刷新';
  const label =
    age < HOUR
      ? `${Math.floor(age / MINUTE)} 分钟前刷新`
      : age < DAY
        ? `${Math.floor(age / HOUR)} 小时前刷新`
        : `${Math.floor(age / DAY)} 天前刷新`;
  return stale ? `${label} · 可能已经过时` : label;
}
