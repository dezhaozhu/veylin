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
  pickGlanceChanges,
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
 * Default glance matches the chat shell: title, status, four numbers.
 * Charts, judgment, findings, and narrative stay behind “详细检查”.
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

  const [detailsOpen, setDetailsOpen] = useState(true);
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [narrativeOpen, setNarrativeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTabId | null>(null);
  const effectiveTab = activeTab ?? tabGroups[0]?.tab ?? null;
  const checkedAt = narrative?.generatedAt ?? previousAt;
  const glanceChanges = useMemo(
    () => pickGlanceChanges(heroes, deltas, previousAt != null),
    [heroes, deltas, previousAt],
  );
  const glanceChip =
    trust?.band === 'blocked'
      ? 'glanceChipBlocked'
      : trust?.band === 'caution'
        ? 'glanceChipCaution'
        : 'glanceChipReady';
  const topCapacity = capacityBars[0] ?? null;

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
    <div className={cn('flex h-full min-h-0 w-full flex-col gap-3', className)}>
      <section className="border-border/60 shrink-0 rounded-xl border px-4 py-3.5">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">
                {t('projectPage.checkupTitle')}
              </h2>
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px]">
                {t(`projectPage.${glanceChip}`)}
                {attention.length > 0
                  ? ` · ${t('projectPage.glanceIssues', { count: attention.length })}`
                  : ''}
              </span>
            </div>
            <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
              {previousAt ? (
                <>
                  {t('projectPage.sinceLastPrefix')}
                  {glanceChanges.length > 0 ? '：' : ' · '}
                  {glanceChanges.map((c, i) => (
                    <span key={`${c.label}-${i}`}>
                      {i > 0 ? ' · ' : null}
                      {c.delta === 0
                        ? t('projectPage.glanceChangeSame', { label: c.label })
                        : t('projectPage.glanceChangeDelta', {
                            label: c.label,
                            delta: `${c.delta > 0 ? '+' : ''}${c.delta}`,
                          })}
                    </span>
                  ))}
                  {checkedAt ? (
                    <span className="tabular-nums">
                      {glanceChanges.length > 0 ? ' · ' : ''}
                      {formatGeneratedAt(previousAt)}
                    </span>
                  ) : null}
                </>
              ) : (
                t('projectPage.firstVisitBaseline')
              )}
            </p>
          </div>
        </header>

        {heroes.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {heroes.map((h) => {
              const delta = typeof h.num === 'number' ? deltas[h.key] : undefined;
              return (
                <div key={h.key} className="bg-muted/50 min-w-0 rounded-lg px-3 py-2.5">
                  <p className="text-lg font-semibold tracking-tight tabular-nums">
                    {typeof h.num === 'number' ? formatInt(h.num) : h.value}
                    {delta != null ? (
                      <span className="ml-1.5 align-middle">
                        <DeltaBadge delta={delta} />
                      </span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">{h.label}</p>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      {/* Text judgment + findings + narrative — fills leftover height; scrolls inside */}
      <div
        className={cn(
          'border-border/60 flex min-h-0 flex-col rounded-lg border',
          detailsOpen && 'flex-1',
        )}
      >
        <button
          type="button"
          className="hover:bg-muted/40 flex shrink-0 items-center gap-2 px-3 py-2.5 text-left text-sm font-medium"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((v) => !v)}
        >
          <ChevronDownIcon
            className={cn(
              'text-muted-foreground size-4 shrink-0 transition-transform',
              detailsOpen ? 'rotate-0' : '-rotate-90',
            )}
          />
          {t('projectPage.viewDetails')}
        </button>

        {detailsOpen ? (
        <div className="border-border/50 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain border-t px-3 py-3">
          {(trust || honesty.length > 0 || rulesRate || capacityBars.length > 0) ? (
            <section className="flex flex-col gap-3">
              <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-6">
                {trust ? <TrustScoreRing score={trust.score} band={trust.band} /> : null}
                {honesty.length > 0 ? <HonestyBarChart segments={honesty} /> : null}
                {rulesRate ? <RulesHitRing rate={rulesRate} /> : null}
              </div>
              {capacityBars.length > 0 ? (
                <div>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 text-left text-xs"
                    onClick={() => setCapacityOpen((v) => !v)}
                    aria-expanded={capacityOpen}
                  >
                    <ChevronDownIcon
                      className={cn(
                        'size-3.5 shrink-0 transition-transform',
                        capacityOpen ? 'rotate-0' : '-rotate-90',
                      )}
                    />
                    <span>
                      <span className="text-foreground font-medium">{t('projectPage.chartCapacity')}</span>
                      {' · '}
                      {topCapacity
                        ? t('projectPage.capacityGlance', {
                            count: capacityBars.length + (capacityTruncated ?? 0),
                            name: topCapacity.label,
                            k: topCapacity.num,
                          })
                        : t('projectPage.capacityGlancePlain', { count: capacityBars.length })}
                    </span>
                  </button>
                  {capacityOpen ? (
                    <div className="mt-3">
                      <CapacityBarChart bars={capacityBars} truncated={capacityTruncated} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="min-w-0">
            <p className="text-muted-foreground text-[11px] font-medium tracking-wide">
              {t('projectPage.aiJudgment')}
            </p>
            <h3 className="mt-1 text-base font-semibold tracking-tight">
              {showSplitVerdict
                ? t('projectPage.verdictLeadUsable')
                : t(`projectPage.${verdict.key}`, verdict.params)}
            </h3>
            <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
              {t(`projectPage.${recommend}`)}
            </p>

            {attention.length > 0 ? (
              <div className="mt-4">
                <p className="text-muted-foreground mb-2 text-[11px] font-medium">
                  {t('projectPage.attentionTitle')}
                  <span className="ml-1.5 tabular-nums">{attention.length}</span>
                </p>
                <ul className="flex flex-col gap-2">
                  {attention.map((item, i) => {
                    const metric = formatMetric(item);
                    return (
                      <li
                        key={item.id}
                        className="bg-muted/45 flex items-start justify-between gap-3 rounded-lg px-3 py-2.5"
                      >
                        <div className="flex min-w-0 gap-2.5">
                          <span className="text-muted-foreground w-5 shrink-0 pt-0.5 text-[11px] tabular-nums">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium leading-snug">
                              {t(`projectPage.${item.titleKey}`)}
                            </p>
                            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                              {t(`projectPage.${item.detailKey}`, item.detailParams)}
                            </p>
                          </div>
                        </div>
                        {metric ? (
                          <span className="text-foreground/80 shrink-0 pt-0.5 text-xs font-medium tabular-nums">
                            {metric}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {positives.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {positives.map((p) => (
                  <li
                    key={p.id}
                    className="text-muted-foreground flex items-center gap-1.5 text-[11px]"
                  >
                    <CheckIcon className="size-3 shrink-0 text-emerald-700/80 dark:text-emerald-400/80" />
                    {t(`projectPage.${p.titleKey}`)}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {narrative ? (
            <div className="border-border/50 min-w-0 border-t pt-3">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 text-left text-xs"
                aria-expanded={narrativeOpen}
                onClick={() => setNarrativeOpen((v) => !v)}
              >
                <ChevronDownIcon
                  className={cn(
                    'size-3.5 shrink-0 transition-transform',
                    narrativeOpen ? 'rotate-0' : '-rotate-90',
                  )}
                />
                <span className="font-medium">{t('projectPage.narrative')}</span>
                {narrative.generatedAt ? (
                  <span className="ml-auto tabular-nums">
                    {t('projectPage.narrativeAt', {
                      date: formatGeneratedAt(narrative.generatedAt),
                    })}
                  </span>
                ) : null}
              </button>
              {narrativeOpen ? (
                <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                  {narrative.text}
                </p>
              ) : null}
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
        ) : null}
      </div>
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
