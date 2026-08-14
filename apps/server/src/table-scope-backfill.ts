/**
 * 老表的归属回填(spec §3.6)。
 *
 * 老库里的表没有 `scope`,id 也没有作用域前缀。这里**只算计划,不落库** ——
 * 落库是 initTableStore 的事,把决策与副作用分开是为了能先 dry-run 看一眼:
 * id 改写要级联 table_column / table_row 的 sheet_id,是本刀风险最高的一步。
 *
 * 两条规则,幂等:
 *   1. `source.project` 有值 → 那个项目
 *   2. 其余(含老的对话级表) → 个人区
 *
 * 只有 `source.server` 没有 `project` 的老戳**不猜项目**:猜错就是把一个项目的
 * 数据塞进另一个项目,宁可留在个人区等人重装一次。
 *
 * **老的对话级表也归个人区**,不保留 `thread` 归属:今天没有任何入口会去列
 * "某个对话的表"(作用域只从项目钉定推,见 spec §3.3),留成 thread 就等于谁也
 * 看不见 —— 那是数据丢失的观感。面板上建的表本来就该是工作区行为(§3.4),
 * 归到个人区正好对上。`thread` 这一档留在类型里,等真需要"这一轮的临时表"时再用。
 */
import {
  PERSONAL_SCOPE,
  projectScope,
  scopeOfSheetId,
  sheetIdFor,
  type SheetScope,
} from './table-scope.js';

export type BackfillEntry = { from: string; to: string; scope: SheetScope };

type SheetLike = {
  id: string;
  threadId?: string | null;
  scope?: SheetScope;
  source?: { server?: string; project?: string } | null;
};

export function planScopeBackfill(sheets: SheetLike[]): BackfillEntry[] {
  const taken = new Set(sheets.map((s) => s.id));
  const plan: BackfillEntry[] = [];

  for (const s of sheets) {
    // 已经归好属的(有 scope,或 id 已带前缀)跳过 —— 幂等
    if (s.scope || scopeOfSheetId(s.id)) continue;

    const scope: SheetScope = s.source?.project
      ? projectScope(s.source.project)
      : PERSONAL_SCOPE;

    let to = sheetIdFor(scope, s.id);
    let n = 1;
    while (taken.has(to)) to = `${sheetIdFor(scope, s.id)}_${n++}`;
    taken.add(to);
    plan.push({ from: s.id, to, scope });
  }
  return plan;
}
