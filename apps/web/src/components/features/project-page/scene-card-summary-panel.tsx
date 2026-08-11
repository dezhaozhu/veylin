import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { DisplayRow } from './scene-card-merge';
import {
  CapacityBarChart,
  HonestyBarChart,
  RulesHitRing,
  TrustScoreRing,
} from './scene-card-summary-charts';
import {
  buildNumMap,
  checkupVerdict,
  computeDeltas,
  computeTrustScore,
  extractAttentionItems,
  extractCapacityBars,
  extractCapacityTruncated,
  extractHonestySegments,
  extractJudgmentPositives,
  extractRulesHitRate,
  groupDisplayBySection,
  groupSectionsByTab,
  pickKeyMetrics,
  readSceneSnapshot,
  recommendationKey,
  remainingDisplayRows,
  writeSceneSnapshot,
  type AttentionItem,
  type DetailTabId,
  type NarrativeSnippet,
  type SceneVisitSnapshot,
} from './scene-card-summary';
import { useOpenCorrection } from './use-open-correction';

/**
 * Chart-first checkup glance:
 *   trust ring + honesty bar + rules ring → scale KPIs → capacity bars
 * Text judgment / findings / narrative stay behind “查看结论与明细”.
 */
export const SceneCardSummaryPanel: FC<{
  rows: readonly DisplayRow[];
  narrative: NarrativeSnippet | null;
  source: string;
  projectId: string;
  className?: string;
}> = ({ rows, narrative, source, projectId, className }) => {
  const { t } = useTranslation();
  const openCorrection = useOpenCorrection(projectId);
  const heroes = useMemo(() => pickKeyMetrics(rows, 4), [rows]);
  const sections = useMemo(
    () => groupDisplayBySection(remainingDisplayRows(rows, heroes)),
    [rows, heroes],
  );
  const tabGroups = useMemo(() => groupSectionsByTab(sections), [sections]);
  const honesty = useMemo(() => extractHonestySegments(rows), [rows]);
  const trust = useMemo(() => computeTrustScore(honesty), [honesty]);
  const capacityBars = useMemo(() => extractCapacityBars(rows, 12), [rows]);
  const capacityTruncated = useMemo(() => extractCapacityTruncated(rows), [rows]);
  const rulesRate = useMemo(() => extractRulesHitRate(rows), [rows]);
  const attention = useMemo(
    () => extractAttentionItems(rows, honesty, rulesRate, capacityTruncated),
    [rows, honesty, rulesRate, capacityTruncated],
  );
  const positives = useMemo(
    () => extractJudgmentPositives(heroes, capacityBars),
    [heroes, capacityBars],
  );
  const verdict = useMemo(
    () => checkupVerdict(trust, attention.length),
    [trust, attention.length],
  );
  const recommend = recommendationKey(trust, attention.length);

  const baselineRef = useRef<SceneVisitSnapshot | null | undefined>(undefined);
  if (baselineRef.current === undefined) {
    baselineRef.current = readSceneSnapshot(projectId, source);
  }
  const previousAt = baselineRef.current?.at ?? null;
  const deltas = useMemo(
    () => computeDeltas(buildNumMap(rows), baselineRef.current?.nums ?? null),
    [rows],
  );

  useEffect(() => {
    const save = () =>
      writeSceneSnapshot(projectId, source, {
        at: new Date().toISOString(),
        nums: buildNumMap(rows),
      });
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [projectId, source, rows]);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTabId | null>(null);
  const effectiveTab = activeTab ?? tabGroups[0]?.tab ?? null;
  const checkedAt = narrative?.generatedAt ?? previousAt;
  const changedCount = Object.keys(deltas).length;

  const report = (row: DisplayRow) => {
    openCorrection(source, {
      scene: source,
      section: row.section,
      label: row.label,
      current: row.value,
    });
  };

  const formatMetric = (item: AttentionItem): string | null => {
    if (item.id === 'rules-hit-low' && item.detailParams) {
      return `${item.detailParams.hit} / ${item.detailParams.active}`;
    }
    if (item.id === 'honesty-missing' && item.detailParams?.count != null) {
      return t('projectPage.metricItems', { count: item.detailParams.count });
    }
    if (item.id === 'capacity-truncated' && item.detailParams?.count != null) {
      return t('projectPage.metricItems', { count: item.detailParams.count });
    }
    if (item.id === 'furnace-rules' && item.detailParams?.count != null) {
      return t('projectPage.metricRules', { count: item.detailParams.count });
    }
    return item.metric ?? null;
  };

  const showSplitVerdict =
    attention.length > 0 && trust != null && trust.band !== 'blocked';

  return (
    <div className={cn('mb-8 flex w-full flex-col gap-5', className)}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">
            {t('projectPage.checkupTitle')}
          </h2>
          <p className="text-muted-foreground text-xs">
            {t('projectPage.focusHintVisual')}
          </p>
        </div>
        {checkedAt ? (
          <p className="text-muted-foreground text-[11px] tabular-nums">
            {t('projectPage.lastUpdated')} {formatGeneratedAt(checkedAt)}
          </p>
        ) : null}
      </header>

      {/* Visual glance cluster */}
      <section className="border-border/60 bg-muted/15 flex flex-col gap-5 rounded-xl border px-5 py-5">
        <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-8">
          {trust ? <TrustScoreRing score={trust.score} band={trust.band} /> : null}
          {honesty.length > 0 ? <HonestyBarChart segments={honesty} /> : null}
          {rulesRate ? <RulesHitRing rate={rulesRate} /> : null}
        </div>
        {capacityBars.length > 0 ? (
          <>
            <div className="border-border/50 border-t" />
            <CapacityBarChart bars={capacityBars} truncated={capacityTruncated} />
          </>
        ) : null}
      </section>

      {/* Scale numbers */}
      {heroes.length > 0 ? (
        <section
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${Math.min(heroes.length, 4)}, minmax(0, 1fr))`,
          }}
        >
          {heroes.map((h) => {
            const delta = typeof h.num === 'number' ? deltas[h.key] : undefined;
            return (
              <div key={h.key} className="bg-muted/40 group/hero relative rounded-xl px-3 py-2.5">
                <p className="text-muted-foreground text-[11px] font-medium tracking-wide">
                  {h.label}
                </p>
                <p className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-xl font-semibold tracking-tight tabular-nums">
                    {typeof h.num === 'number' ? formatInt(h.num) : h.value}
                  </span>
                  {delta != null ? <DeltaBadge delta={delta} /> : null}
                </p>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground absolute top-2 right-2 text-[10px] opacity-0 transition-opacity group-hover/hero:opacity-100 focus-visible:opacity-100"
                  onClick={() => report(h)}
                >
                  {t('projectPage.reportWrong')}
                </button>
              </div>
            );
          })}
        </section>
      ) : null}

      {previousAt ? (
        <p className="text-muted-foreground -mt-2 text-[11px]">
          {changedCount > 0
            ? t('projectPage.changedSinceVisit', {
                count: changedCount,
                date: formatGeneratedAt(previousAt),
              })
            : t('projectPage.unchangedSinceVisit', {
                date: formatGeneratedAt(previousAt),
              })}
        </p>
      ) : (
        <p className="text-muted-foreground -mt-2 text-[11px]">
          {t('projectPage.firstVisitBaseline')}
        </p>
      )}

      {/* Text judgment + findings + narrative — on demand */}
      <details
        className="border-border/60 rounded-lg border"
        open={detailsOpen}
        onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="hover:bg-muted/40 cursor-pointer list-none px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <ChevronDownIcon
              className={cn(
                'text-muted-foreground size-4 shrink-0 transition-transform',
                detailsOpen ? 'rotate-0' : '-rotate-90',
              )}
            />
            {t('projectPage.viewDetails')}
            {attention.length > 0 ? (
              <span className="text-muted-foreground text-xs font-normal">
                · {t('projectPage.verdictIssuesLine', { count: attention.length })}
              </span>
            ) : null}
          </span>
        </summary>

        <div className="border-border/50 flex flex-col gap-5 border-t px-3 py-3">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-medium tracking-wide">
              {t('projectPage.aiJudgment')}
            </p>
            {showSplitVerdict ? (
              <div className="mt-1">
                <p className="text-sm font-semibold">{t('projectPage.verdictLeadUsable')}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t('projectPage.verdictIssuesLine', { count: attention.length })}
                </p>
              </div>
            ) : (
              <p className="mt-1 text-sm font-semibold">
                {t(`projectPage.${verdict.key}`, verdict.params)}
              </p>
            )}
            {positives.length > 0 ? (
              <ul className="mt-2.5 flex flex-col gap-1">
                {positives.map((p) => (
                  <li key={p.id} className="flex items-start gap-2 text-xs">
                    <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                    <span>{t(`projectPage.${p.titleKey}`)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              <span className="text-foreground/85 font-medium">
                {t('projectPage.recommendLabel')}
              </span>{' '}
              {t(`projectPage.${recommend}`)}
            </p>
          </div>

          {attention.length > 0 ? (
            <ol className="divide-border/35 divide-y">
              {attention.map((item, i) => {
                const metric = formatMetric(item);
                return (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 gap-2">
                      <span className="text-muted-foreground w-5 shrink-0 text-xs tabular-nums">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t(`projectPage.${item.titleKey}`)}</p>
                        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                          {t(`projectPage.${item.detailKey}`, item.detailParams)}
                        </p>
                      </div>
                    </div>
                    {metric ? (
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {metric}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}

          {narrative ? (
            <div className="min-w-0">
              <div className="text-muted-foreground mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-medium">{t('projectPage.narrative')}</span>
                {narrative.generatedAt ? (
                  <span>
                    {t('projectPage.narrativeAt', {
                      date: formatGeneratedAt(narrative.generatedAt),
                    })}
                  </span>
                ) : null}
              </div>
              <p className="text-sm leading-relaxed">{narrative.text}</p>
            </div>
          ) : null}

          {tabGroups.length > 0 ? (
            <>
              <div
                className="border-border/40 flex flex-wrap gap-1 border-b"
                role="tablist"
                aria-label={t('projectPage.detailTabs')}
              >
                {tabGroups.map(({ tab }) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={effectiveTab === tab}
                    className={cn(
                      '-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                      effectiveTab === tab
                        ? 'border-foreground text-foreground'
                        : 'text-muted-foreground hover:text-foreground border-transparent',
                    )}
                    onClick={() => setActiveTab(tab)}
                  >
                    {t(`projectPage.detailTab.${tab}`)}
                  </button>
                ))}
              </div>
              {tabGroups
                .filter((g) => g.tab === effectiveTab)
                .map((g) => (
                  <div key={g.tab} className="flex flex-col gap-4" role="tabpanel">
                    {g.sections.map((sec) => (
                      <div key={sec.section}>
                        <p className="text-muted-foreground mb-2 text-xs font-medium">
                          {sec.section}
                        </p>
                        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                          {sec.rows.map((r) => {
                            const delta =
                              typeof r.num === 'number' ? deltas[r.key] : undefined;
                            return (
                              <div
                                key={r.key}
                                className="group/fact flex min-w-0 items-baseline justify-between gap-3 py-1"
                              >
                                <dt className="text-muted-foreground min-w-0 truncate text-xs">
                                  {r.label}
                                </dt>
                                <dd className="flex shrink-0 items-baseline gap-1.5 text-sm tabular-nums">
                                  <span>{r.value}</span>
                                  {delta != null ? <DeltaBadge delta={delta} /> : null}
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground text-[10px] opacity-0 transition-opacity group-hover/fact:opacity-100 focus-visible:opacity-100"
                                    onClick={() => report(r)}
                                  >
                                    {t('projectPage.reportWrong')}
                                  </button>
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      </div>
                    ))}
                  </div>
                ))}
            </>
          ) : null}
        </div>
      </details>
    </div>
  );
};

function DeltaBadge({ delta }: { delta: number }) {
  const sign = delta > 0 ? '+' : '';
  return (
    <span
      className="text-xs font-medium tabular-nums"
      style={{
        color: delta > 0 ? 'var(--tone-warning, #b8860b)' : 'var(--tone-positive, #2e7d32)',
      }}
      title={`${sign}${delta}`}
    >
      {sign}
      {delta}
    </span>
  );
}

function formatGeneratedAt(raw: string): string {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return raw;
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return raw;
  }
}

function formatInt(n: number): string {
  try {
    return new Intl.NumberFormat().format(n);
  } catch {
    return String(n);
  }
}
