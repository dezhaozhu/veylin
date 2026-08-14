/**
 * 切焦段时把「怎么看的」带过去:分组与筛选。
 *
 * 三个焦段是同一个模型的三个视角,列却不完全一样 —— 工序级有「分厂」,派工级只有
 * 「设备/工作中心」。列不在新焦段里,那一项就无处安放。
 *
 * **丢掉必须说出来。** 悄悄丢是最糟的:人以为还筛着,读出错的结论。与锚点那条
 * (`grain-anchor.ts`)、覆盖率披露是同一条线 —— 凡是没做到的,自己讲出来。
 */
export type GrainView = {
  groupBy: string[];
  /** 列 key → 筛选词(空白视为没筛) */
  filters: Record<string, string>;
};

export type CarriedView = GrainView & {
  /** 新焦段里没有这一列,所以带不过去 */
  dropped: Array<{ key: string; from: 'group' | 'filter' | 'both' }>;
};

export function carryViewAcrossGrain(view: GrainView, columns: Set<string>): CarriedView {
  const activeFilters = Object.entries(view.filters).filter(([, v]) => String(v ?? '').trim());

  const keptGroup = view.groupBy.filter((k) => columns.has(k));
  const keptFilters: Record<string, string> = {};
  for (const [k, v] of activeFilters) if (columns.has(k)) keptFilters[k] = v;

  const lostGroup = new Set(view.groupBy.filter((k) => !columns.has(k)));
  const lostFilter = new Set(activeFilters.filter(([k]) => !columns.has(k)).map(([k]) => k));

  const dropped = [...new Set([...lostGroup, ...lostFilter])].sort().map((key) => ({
    key,
    from: (lostGroup.has(key) && lostFilter.has(key)
      ? 'both'
      : lostGroup.has(key)
        ? 'group'
        : 'filter') as 'group' | 'filter' | 'both',
  }));

  return { groupBy: keptGroup, filters: keptFilters, dropped };
}
