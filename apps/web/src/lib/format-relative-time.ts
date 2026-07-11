/** Compact relative time for chat list rows (e.g. 1m, 2h, 2d, 1mo). */
export function formatRelativeTimeShort(date: Date, now = Date.now()): string {
  const diffMs = Math.max(0, now - date.getTime());
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${Math.max(1, diffMin)}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays < 30) return `${Math.max(1, diffDays)}d`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${Math.max(1, diffMonths)}mo`;
}
