import { useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { CapacityBar, HonestySegment, RulesHitRate } from './scene-card-summary';

/** Tone → CSS color (aligned with Compass scene-card widget palette). */
function toneColor(tone: string | undefined): string {
  switch (tone) {
    case 'positive':
      return 'var(--tone-positive, #2e7d32)';
    case 'info':
      return 'var(--tone-info, #1976d2)';
    case 'warning':
      return 'var(--tone-warning, #b8860b)';
    case 'negative':
      return 'var(--tone-negative, #c62828)';
    default:
      return 'var(--tone-neutral, #6b7280)';
  }
}

/** Proportional honesty strip — the primary visual for data quality. */
export const HonestyBarChart: FC<{
  segments: readonly HonestySegment[];
  className?: string;
}> = ({ segments, className }) => {
  const { t } = useTranslation();
  const total = segments.reduce((s, x) => s + x.num, 0);
  if (total <= 0) return null;
  return (
    <div className={cn('min-w-0 flex-1', className)}>
      <p className="text-foreground mb-2 text-xs font-semibold">{t('projectPage.chartHonesty')}</p>
      <div className="bg-muted flex h-3.5 w-full overflow-hidden rounded-full">
        {segments.map((seg) => (
          <div
            key={seg.key}
            title={`${seg.label}: ${seg.num}`}
            style={{
              width: `${(seg.num / total) * 100}%`,
              backgroundColor: toneColor(seg.tone),
            }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {segments.map((seg) => (
          <li key={seg.key} className="text-muted-foreground flex items-center gap-1.5">
            <span
              className="inline-block size-2 shrink-0 rounded-full"
              style={{ backgroundColor: toneColor(seg.tone) }}
            />
            <span>
              {seg.label}{' '}
              <span className="text-foreground font-medium tabular-nums">{seg.num}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Alias kept for older imports. */
export const HonestyQualityCard = HonestyBarChart;

/**
 * Capacity K: label | bar | value on one line, two columns so bars stay short.
 */
export const CapacityBarChart: FC<{
  bars: readonly CapacityBar[];
  truncated?: number | null;
  previewLimit?: number;
  className?: string;
}> = ({ bars, truncated, previewLimit = 6, className }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const max = Math.max(...bars.map((b) => b.num), 1);
  const visible = expanded ? bars : bars.slice(0, previewLimit);
  const hidden = Math.max(0, bars.length - previewLimit);

  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-foreground text-xs font-semibold">{t('projectPage.chartCapacity')}</p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {truncated != null && truncated > 0
            ? t('projectPage.capacityMetaTruncated', {
                count: bars.length,
                missing: truncated,
              })
            : t('projectPage.capacityResourceCount', { count: bars.length })}
        </p>
      </div>
      <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {visible.map((b) => (
          <li
            key={b.key}
            className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2.75rem] items-center gap-2 text-xs"
          >
            <span className="text-muted-foreground truncate" title={b.label}>
              {b.label}
            </span>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div
                className="bg-foreground/55 h-full rounded-full"
                style={{ width: `${(b.num / max) * 100}%` }}
              />
            </div>
            <span className="text-right font-medium tabular-nums">K={b.num}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground mt-2 text-xs font-medium underline-offset-4 hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? t('projectPage.capacityCollapse')
            : t('projectPage.capacityExpand', { count: bars.length })}
        </button>
      ) : null}
    </div>
  );
};

/** Hit-rate ring — visual companion to honesty. */
export const RulesHitRing: FC<{ rate: RulesHitRate; className?: string }> = ({
  rate,
  className,
}) => {
  const { t } = useTranslation();
  const pct = rate.active > 0 ? rate.hit / rate.active : 0;
  const size = 64;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = pct * c;
  return (
    <div className={cn('flex shrink-0 items-center gap-3', className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={
            pct < 0.15
              ? 'var(--tone-warning, #b8860b)'
              : 'var(--tone-positive, #2e7d32)'
          }
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fill="currentColor"
          style={{ fontSize: 12, fontWeight: 600 }}
        >
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <p className="text-xs font-medium">{t('projectPage.chartRules')}</p>
    </div>
  );
};

/** Trust score as a ring (0–100). */
export const TrustScoreRing: FC<{
  score: number;
  band: 'usable' | 'caution' | 'blocked';
  className?: string;
}> = ({ score, band, className }) => {
  const { t } = useTranslation();
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const size = 88;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = pct * c;
  const strokeColor =
    band === 'blocked'
      ? 'var(--tone-negative, #c62828)'
      : band === 'caution'
        ? 'var(--tone-warning, #b8860b)'
        : 'var(--tone-positive, #2e7d32)';
  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="46%"
          dominantBaseline="central"
          textAnchor="middle"
          fill="currentColor"
          style={{ fontSize: 22, fontWeight: 650 }}
        >
          {score}
        </text>
        <text
          x="50%"
          y="66%"
          dominantBaseline="central"
          textAnchor="middle"
          fill="var(--muted-foreground)"
          style={{ fontSize: 10 }}
        >
          /100
        </text>
      </svg>
      <p className="text-muted-foreground text-xs font-medium">{t('projectPage.trustLabel')}</p>
    </div>
  );
};

export const RulesHealthCard: FC<{ rate: RulesHitRate }> = ({ rate }) => (
  <RulesHitRing rate={rate} />
);
