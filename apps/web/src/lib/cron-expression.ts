import type { TFunction } from 'i18next';

function formatTime(hour: string, minute: string): string | null {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Human-readable label for common 5-field cron expressions (node-cron). */
export function humanizeCronExpression(expr: string, t: TFunction): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (!minute || !hour || !dayOfWeek || dayOfMonth !== '*' || month !== '*') return null;

  const time = formatTime(hour, minute);
  if (!time) return null;

  if (dayOfWeek === '1-5') {
    return t('automate.cronReadableWeekdays', { time });
  }
  if (dayOfWeek === '*') {
    return t('automate.cronReadableDaily', { time });
  }
  if (/^\d$/.test(dayOfWeek)) {
    const day = Number(dayOfWeek);
    if (day >= 0 && day <= 7) {
      return t('automate.cronReadableWeekly', { time, day: dayOfWeek });
    }
  }

  return null;
}
