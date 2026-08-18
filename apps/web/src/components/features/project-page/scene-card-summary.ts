/**
 * Host-side summary helpers for the 项目首页 (one-screen overview).
 *
 * Pure + domain-light: picks “hero” metrics and groups the rest by section so
 * the page can show scale at a glance without mounting the Compass widget.
 * No key is hard-required — heuristics only prefer familiar labels/keys.
 */

import type { DisplayRow } from './scene-card-merge';

export type NarrativeSnippet = { text: string; generatedAt?: string };

/** Ordered preference for hero tiles (at most one row per pattern). */
const HERO_PATTERNS: readonly RegExp[] = [
  /订单|order/i,
  /二级|level\s*2|\bl2\b|工序.*二/i,
  /三级|level\s*3|\bl3\b|工序.*三|工单/i,
  /有效规则|rules\.active|active\s*rules/i,
];

function haystack(row: DisplayRow): string {
  return `${row.key} ${row.label}`;
}

/**
 * Up to four hero metrics for the KPI strip. Prefer one match per hero
 * pattern; fill remaining slots with rows that carry `num`, then any leftover
 * rows — never invent values.
 */
export function pickKeyMetrics(rows: readonly DisplayRow[], limit = 4): DisplayRow[] {
  if (rows.length === 0 || limit <= 0) return [];
  const picked: DisplayRow[] = [];
  const used = new Set<string>();

  for (const pattern of HERO_PATTERNS) {
    if (picked.length >= limit) break;
    const hit = rows.find((r) => !used.has(r.key) && pattern.test(haystack(r)));
    if (!hit) continue;
    used.add(hit.key);
    picked.push(hit);
  }

  const fill = (pred: (r: DisplayRow) => boolean) => {
    for (const r of rows) {
      if (picked.length >= limit) return;
      if (used.has(r.key) || !pred(r)) continue;
      used.add(r.key);
      picked.push(r);
    }
  };

  fill((r) => typeof r.num === 'number');
  fill(() => true);
  return picked;
}

/** Keys already shown as hero tiles — omit from the collapsible section list. */
export function remainingDisplayRows(
  rows: readonly DisplayRow[],
  heroes: readonly DisplayRow[],
): DisplayRow[] {
  const heroKeys = new Set(heroes.map((h) => h.key));
  return rows.filter((r) => !heroKeys.has(r.key));
}

/** Group rows by `section`, preserving first-seen section and row order. */
export function groupDisplayBySection(
  rows: readonly DisplayRow[],
): Array<{ section: string; rows: DisplayRow[] }> {
  const order: string[] = [];
  const map = new Map<string, DisplayRow[]>();
  for (const row of rows) {
    const list = map.get(row.section);
    if (list) {
      list.push(row);
    } else {
      order.push(row.section);
      map.set(row.section, [row]);
    }
  }
  return order.map((section) => ({ section, rows: map.get(section)! }));
}

/**
 * Truncate narrative for the default one-liner. Returns the full text when it
 * already fits; `truncated` is true only when a longer original was cut.
 */
export function truncateNarrative(
  text: string,
  maxChars = 120,
): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return { text: trimmed, truncated: false };
  // Prefer a break near a Chinese/ASCII sentence end inside the budget.
  const slice = trimmed.slice(0, maxChars);
  const breakAt = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('；'), slice.lastIndexOf('. '));
  const cut = breakAt >= Math.floor(maxChars * 0.5) ? slice.slice(0, breakAt + 1) : slice;
  return { text: `${cut.replace(/\s+$/u, '')}…`, truncated: true };
}

/** One segment of a proportional honesty bar (from `honesty.*` display rows). */
export type HonestySegment = {
  key: string;
  label: string;
  num: number;
  tone?: string;
};

/** Parallel-K bar for the capacity strip (from `capacity.k.*` rows). */
export type CapacityBar = { key: string; label: string; num: number };

/** Hit-rate ring inputs (from `rules.active` + `rules.hit`). */
export type RulesHitRate = { active: number; hit: number };

/**
 * Honesty breakdown for a stacked bar. Only rows with key `honesty.*` and a
 * finite `num` — omitted entirely when none (never invent a chart).
 */
export function extractHonestySegments(rows: readonly DisplayRow[]): HonestySegment[] {
  return rows
    .filter(
      (r): r is DisplayRow & { num: number } =>
        r.key.startsWith('honesty.') && typeof r.num === 'number' && Number.isFinite(r.num) && r.num >= 0,
    )
    .map((r) => ({
      key: r.key,
      label: r.label,
      num: r.num,
      ...(r.tone ? { tone: r.tone } : {}),
    }));
}

/**
 * Top parallel-K resources for a bar strip. Skips `_truncated` and non-numeric
 * rows; highest K first, capped.
 */
export function extractCapacityBars(rows: readonly DisplayRow[], limit = 12): CapacityBar[] {
  return rows
    .filter(
      (r): r is DisplayRow & { num: number } =>
        r.key.startsWith('capacity.k.') &&
        !r.key.endsWith('._truncated') &&
        !r.key.includes('._truncated') &&
        typeof r.num === 'number' &&
        Number.isFinite(r.num) &&
        r.num > 0,
    )
    .slice()
    .sort((a, b) => b.num - a.num)
    .slice(0, limit)
    .map((r) => ({ key: r.key, label: r.label, num: r.num }));
}

/** Count of resources omitted from the K strip (`capacity.k._truncated`). */
export function extractCapacityTruncated(rows: readonly DisplayRow[]): number | null {
  const row = rows.find(
    (r) =>
      (r.key === 'capacity.k._truncated' || r.key.endsWith('._truncated')) &&
      r.key.includes('capacity'),
  );
  if (!row || typeof row.num !== 'number' || !Number.isFinite(row.num) || row.num <= 0) {
    return null;
  }
  return row.num;
}

export type TrustScore = {
  score: number;
  /** i18n key suffix under projectPage.trust*: usable | caution | blocked */
  band: 'usable' | 'caution' | 'blocked';
};

/**
 * 0–100 trust score from honesty.* breakdown. Heuristic only — never invents
 * segments. Missing/guess pull the score down; real/inferred lift it.
 */
export function computeTrustScore(segments: readonly HonestySegment[]): TrustScore | null {
  if (segments.length === 0) return null;
  let inferred = 0;
  let guess = 0;
  let missing = 0;
  for (const s of segments) {
    const hay = `${s.key} ${s.label}`;
    if (/missing|缺失/.test(hay)) missing += s.num;
    else if (/real|true|truth|真值/.test(hay)) {
      /* real items do not penalize */
    } else if (/infer|deriv|推断/.test(hay)) inferred += s.num;
    else if (/guess|猜测/.test(hay)) guess += s.num;
    else inferred += s.num;
  }
  // 真值2 / 推断2 / 猜测1 / 缺失1 → 100−10−5−4 = 81
  const score = Math.max(
    0,
    Math.min(100, Math.round(100 - missing * 10 - guess * 5 - inferred * 2)),
  );
  const band: TrustScore['band'] =
    score >= 80 ? 'usable' : score >= 55 ? 'caution' : 'blocked';
  return { score, band };
}

export type AttentionItem = {
  id: string;
  /** Stable i18n key under projectPage.attention.* */
  titleKey: string;
  detailKey: string;
  detailParams?: Record<string, string | number>;
  /** Compact metric shown on the right of the risk row, e.g. "5 / 96". */
  metric?: string;
  severity: 'warn' | 'info';
};

export type JudgmentPositive = {
  id: string;
  titleKey: string;
};

/** Green checks for the AI judgment panel — only when evidence exists. */
export function extractJudgmentPositives(
  heroes: readonly DisplayRow[],
  capacityBars: readonly CapacityBar[],
): JudgmentPositive[] {
  const out: JudgmentPositive[] = [];
  const numericHeroes = heroes.filter((h) => typeof h.num === 'number' && h.num > 0).length;
  if (numericHeroes >= 3) {
    out.push({ id: 'scale', titleKey: 'judgeScaleOk' });
  }
  if (capacityBars.length >= 3) {
    out.push({ id: 'capacity', titleKey: 'judgeCapacityOk' });
  }
  return out;
}

/**
 * One-line scheduling readiness headline for the report hero.
 * Params: `{ count }` = attention item count when relevant.
 */
export function checkupVerdict(
  trust: TrustScore | null,
  attentionCount: number,
): { key: string; params?: Record<string, string | number> } {
  if (trust?.band === 'blocked') {
    return { key: 'verdictBlocked', params: { count: attentionCount } };
  }
  if (attentionCount > 0) {
    return { key: 'verdictUsableWithIssues', params: { count: attentionCount } };
  }
  if (trust?.band === 'caution') {
    return { key: 'verdictCaution' };
  }
  return { key: 'verdictReady' };
}

export function recommendationKey(
  trust: TrustScore | null,
  attentionCount: number,
): string {
  if (trust?.band === 'blocked') return 'recommendBlocked';
  if (attentionCount > 0) return 'recommendFixFirst';
  return 'recommendReady';
}

/**
 * Decision-facing alerts derived from display rows. Empty when nothing looks
 * off — the page then skips the “需要关注” block entirely.
 */
export function extractAttentionItems(
  rows: readonly DisplayRow[],
  honesty: readonly HonestySegment[],
  rules: RulesHitRate | null,
  capacityTruncated: number | null,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (rules && rules.active > 0 && rules.hit / rules.active < 0.2) {
    items.push({
      id: 'rules-hit-low',
      titleKey: 'attentionRulesHitTitle',
      detailKey: 'attentionRulesHitDetail',
      detailParams: { hit: rules.hit, active: rules.active },
      metric: `${rules.hit} / ${rules.active}`,
      severity: 'warn',
    });
  }

  const missingSeg = honesty.find((s) => /missing|缺失/.test(`${s.key} ${s.label}`));
  if (missingSeg && missingSeg.num > 0) {
    items.push({
      id: 'honesty-missing',
      titleKey: 'attentionMissingTitle',
      detailKey: 'attentionMissingDetail',
      detailParams: { count: missingSeg.num },
      metric: `${missingSeg.num}`,
      severity: 'warn',
    });
  }

  if (capacityTruncated != null && capacityTruncated > 0) {
    items.push({
      id: 'capacity-truncated',
      titleKey: 'attentionCapacityTitle',
      detailKey: 'attentionCapacityDetail',
      detailParams: { count: capacityTruncated },
      metric: `${capacityTruncated}`,
      severity: 'warn',
    });
  }

  const furnace = rows.filter((r) => {
    const hay = `${r.key} ${r.label} ${r.value}`;
    return /furnace|拼炉|炉规|炉规则|batch.?furnace/i.test(hay);
  });
  if (furnace.length > 0) {
    const count =
      furnace.reduce((sum, r) => sum + (typeof r.num === 'number' ? r.num : 0), 0) ||
      furnace.length;
    items.push({
      id: 'furnace-rules',
      titleKey: 'attentionFurnaceTitle',
      detailKey: 'attentionFurnaceDetail',
      detailParams: { count },
      metric: `${count}`,
      severity: 'info',
    });
  }

  return items;
}

/** Tab buckets for the detail strip — section-name heuristics, order fixed. */
export type DetailTabId = 'data' | 'capacity' | 'rules' | 'other';

export function tabForSection(section: string): DetailTabId {
  if (/诚实|honest|数据口径|问题结构|问题/.test(section)) return 'data';
  if (/产能|capacity|资源/.test(section)) return 'capacity';
  if (/规则|rule/.test(section)) return 'rules';
  return 'other';
}

export const DETAIL_TAB_ORDER: readonly DetailTabId[] = [
  'data',
  'capacity',
  'rules',
  'other',
] as const;

/** Group section buckets into detail tabs; omit empty tabs. */
export function groupSectionsByTab(
  sections: readonly { section: string; rows: DisplayRow[] }[],
): Array<{ tab: DetailTabId; sections: Array<{ section: string; rows: DisplayRow[] }> }> {
  const buckets = new Map<DetailTabId, Array<{ section: string; rows: DisplayRow[] }>>();
  for (const g of sections) {
    const tab = tabForSection(g.section);
    const list = buckets.get(tab);
    if (list) list.push(g);
    else buckets.set(tab, [g]);
  }
  return DETAIL_TAB_ORDER.filter((tab) => (buckets.get(tab)?.length ?? 0) > 0).map((tab) => ({
    tab,
    sections: buckets.get(tab)!,
  }));
}

/**
 * Rule hit-rate for a ring chart. Needs both `rules.active` and `rules.hit`
 * with finite nums; otherwise null (chart omitted).
 */
export function extractRulesHitRate(rows: readonly DisplayRow[]): RulesHitRate | null {
  const active = rows.find((r) => r.key === 'rules.active');
  const hit = rows.find((r) => r.key === 'rules.hit');
  if (
    active == null ||
    hit == null ||
    typeof active.num !== 'number' ||
    typeof hit.num !== 'number' ||
    !Number.isFinite(active.num) ||
    !Number.isFinite(hit.num) ||
    active.num <= 0
  ) {
    return null;
  }
  return { active: active.num, hit: Math.max(0, Math.min(hit.num, active.num)) };
}

/** Numeric map for visit-to-visit deltas (key → num). */
export function buildNumMap(rows: readonly DisplayRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (typeof r.num === 'number' && Number.isFinite(r.num)) out[r.key] = r.num;
  }
  return out;
}

/**
 * Per-key delta (current − previous). Only keys present in BOTH maps with a
 * non-zero difference — first visit / missing previous ⇒ empty.
 */
export function computeDeltas(
  current: Record<string, number>,
  previous: Record<string, number> | null | undefined,
): Record<string, number> {
  if (!previous) return {};
  const out: Record<string, number> = {};
  for (const [key, cur] of Object.entries(current)) {
    const prev = previous[key];
    if (typeof prev !== 'number' || !Number.isFinite(prev)) continue;
    const d = cur - prev;
    if (d !== 0) out[key] = d;
  }
  return out;
}

export type GlanceChange = { label: string; delta: number };

/**
 * Hero numbers for the "since last visit" line. Changed keys first; fill with
 * unchanged heroes so first glance still says something concrete.
 */
export function pickGlanceChanges(
  heroes: readonly DisplayRow[],
  deltas: Record<string, number>,
  hasPrevious: boolean,
  limit = 3,
): GlanceChange[] {
  if (!hasPrevious || limit <= 0) return [];
  const numeric = heroes.filter((h) => typeof h.num === 'number');
  const changed: GlanceChange[] = [];
  const same: GlanceChange[] = [];
  for (const h of numeric) {
    const d = deltas[h.key];
    if (typeof d === 'number' && d !== 0) changed.push({ label: h.label, delta: d });
    else same.push({ label: h.label, delta: 0 });
  }
  return [...changed, ...same].slice(0, limit);
}

export type SceneVisitSnapshot = {
  at: string;
  nums: Record<string, number>;
};

export function sceneSnapshotStorageKey(projectId: string, source: string): string {
  return `veylin:scene-snapshot:v1:${projectId}:${source || 'default'}`;
}

export function readSceneSnapshot(
  projectId: string,
  source: string,
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): SceneVisitSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(sceneSnapshotStorageKey(projectId, source));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const at = (parsed as { at?: unknown }).at;
    const nums = (parsed as { nums?: unknown }).nums;
    if (typeof at !== 'string' || !nums || typeof nums !== 'object') return null;
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(nums as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
    }
    return { at, nums: clean };
  } catch {
    return null;
  }
}

export function writeSceneSnapshot(
  projectId: string,
  source: string,
  snapshot: SceneVisitSnapshot,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(sceneSnapshotStorageKey(projectId, source), JSON.stringify(snapshot));
  } catch {
    /* quota / private mode — ignore */
  }
}
