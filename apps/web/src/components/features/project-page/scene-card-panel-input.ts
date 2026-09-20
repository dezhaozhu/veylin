/**
 * 把「一次 `get_scene_card` 工具调用」翻成 `SceneCardSummaryPanel` 的入参。
 *
 * 项目首页用不到这个模块 —— 那条路上 scene 是页面自己遍历项目数据源得来的,payload
 * 也已经在手里(`use-scene-card-payloads.ts`)。对话流和右侧面板只有"那次工具调用的
 * 片段"一个东西:scene 得从 payload 里认,card 得从 envelope 里剥。
 *
 * ## 为什么需要它
 *
 * 同一份场景卡数据,项目首页渲染的是原生的 `SceneCardSummaryPanel`(结论前置的体检
 * 区 + 四格 KPI + 三张图 + 分页详情),而对话和右栏一律挂 Compass 的 iframe widget
 * —— 后者是五节等重的盒中盒,同一份事实在两个界面上专业程度差一截。这个模块是把
 * 原生那条路接到右栏上的接线口。
 *
 * ## 红线:只补 `display` 确实没投影的那种
 *
 * `display[]` **通常已经带着红线**:真机 guolu 有一条
 * `{key:"red_lines.<uuid>", section:"红线", label:"classless 外协 fallback (…)"}`。
 * 所以绝大多数情况下不用补行 —— 一开始我拿的是另一个租户(红线 0 条)的
 * payload,误以为合同不投影红线,写成"有红线就退回 iframe",结果真机上永远走不到
 * 原生那条路。别再重复这个判断:先看 `display` 里有没有 `red_lines.` 开头的行。
 *
 * 已投影的那种要过一遍 `enrichRedLineRows`:Compass 那行的 `value` 和 `label` 全等
 * (同一句规则名显示两遍),真正的约束写在顶层 `effect` 里。
 *
 * 真正缺的只有**零条红线**那种:payload 顶层写着
 * `{rules: [], count: 0, note: "尚未标定任何红线(L1)…"}`,而 `display` 里一行都没有。
 * "没有红线"是排产前该知道的事实,不是"这一节为空",所以按同一个 `DisplayRow` 形状
 * 补一行,后面的分节/分页机器照常处理,summary 模型一行都不用改。
 *
 * 万一以后出现"有红线、但 display 没投影"的 payload,就从 `red_lines.rules[]` 合成
 * —— 形状是 `{rule_id, name, effect}`(真机核对过)。**这时说不清就交回 iframe**,
 * 不出半张:`rules` 不是数组、条数和 `count` 对不上(有东西被摘掉了而我看不见)、
 * 某条规则没有名字。红线是硬约束 L1,画错比画在丑卡片里糟。仓里到处是这个姿态
 * (`canMergeCards`:一张卡缺 display 就整体退回并排,不出半张对比表)。
 *
 * 顶层 `note` 不补:实物里它是「这里不对?直接在对话里指出」那段界面提示语,不是
 * 事实。原生面板每行自带「报错」,补进去等于把刚收掉的重复提示又请回来。
 *
 * ## 这份领域知识只能待在这里
 *
 * `scene-card-merge.ts` 开头那条 "ZERO domain knowledge lives here: nothing below
 * knows what a `key` means, and no key is ever special-cased" 是那个模块的立身之本
 * (下个月换一批 key 照样能合并)。红线要认字段名,所以不能进去 —— 认字段名的代码
 * 全部收在本文件,越界一次那条不变式就没人信了。
 */
import {
  extractDisplayRows,
  extractNarrative,
  readCardPayload,
  type DisplayRow,
} from './scene-card-merge';
import type { NarrativeSnippet } from './scene-card-summary';

/**
 * 回补行要用的文案。传进来而不是在模块里 `t()`,是为了让这一整套推导保持纯函数、
 * 能单测 —— 和 `scene-card-summary.ts` 里那些 extractor 一样的路子。
 */
export type BackfillLabels = {
  /**
   * 分节标题。**必须让 `tabForSection` 归到「规则」页** —— 红线是最硬的那类规则,
   * 归到「其它」等于把硬约束埋了。那个函数按 section 名的正则分页,所以文案和
   * 正则是一对(`scene-card-summary.ts` 的 `tabForSection`)。
   */
  redLineSection: string;
  /** 零条红线时的行标签(例:标定状态)。 */
  redLineLabel: string;
  /** 零条红线、且 payload 自己也没给说明时的兜底值。 */
  redLineNone: string;
  /** 有红线但那条规则没写 effect 时的兜底值 —— 不留空值,空着看不出是没有还是没给。 */
  redLineNoEffect: string;
};

/** `SceneCardSummaryPanel` 要的那几样,凑齐了才算能走原生。 */
export type SceneCardPanelInput = {
  rows: DisplayRow[];
  narrative: NarrativeSnippet | null;
  /** 场景标识(租户 id),修正桥和访问基线都按它作用域。 */
  source: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 这张卡讲的是哪个场景。
 *
 * **以 payload 的 `tenant` 为准,不看调用参数。** 实测传 `source: 'guolu'` 调回来的
 * 是 `tenant: 'shangzhong'` —— 会话钉定的项目覆盖了参数。信 args 的话,修正草稿会
 * 写着另一个场景的名字,访问基线也会存到错的键下面。
 */
export function sceneCardSource(result: unknown): string | null {
  const payload = readCardPayload(result);
  const tenant = payload?.tenant;
  return typeof tenant === 'string' && tenant.trim() !== '' ? tenant : null;
}

/** Compass 自己给红线行用的 key 前缀 —— 判断"已经投影过了"就看这个。 */
const RED_LINE_KEY_PREFIX = 'red_lines.';

/** `display` 里是否已经带着红线。带了就什么都不用补,也没有东西会被丢掉。 */
export function hasRedLineRows(rows: readonly DisplayRow[]): boolean {
  return rows.some((r) => r.key.startsWith(RED_LINE_KEY_PREFIX));
}

/**
 * 把已投影红线行里退化的 `value` 换成 payload 的 `effect`。
 *
 * Compass 投影红线时左右两边填的是同一句规则名(真机核对:`value` 和 `label` 全等),
 * 于是详情里同一句 70 字长文显示两遍,而真正该看的 `effect`(「吨/月 · 上锅, 东方热能,
 * …」22 个资源)只在 payload 顶层躺着。这不是补一行,是把那行本来就该有的右值填上。
 *
 * **只动全等的那种。** `value` 和 `label` 不一样,说明 Compass 在那行说了别的话,
 * 那是它的合同(`value` 权威),不替它改写。
 */
export function enrichRedLineRows(rows: readonly DisplayRow[], result: unknown): DisplayRow[] {
  const payload = readCardPayload(result);
  const red = payload?.red_lines;
  const rules = isRecord(red) ? red.rules : undefined;
  if (!Array.isArray(rules)) return [...rows];

  const effects = new Map<string, string>();
  for (const raw of rules) {
    if (!isRecord(raw)) continue;
    const ruleId = raw.rule_id;
    const effect = raw.effect;
    if (typeof ruleId !== 'string' || ruleId === '') continue;
    if (typeof effect !== 'string' || effect.trim() === '') continue;
    effects.set(ruleId, effect);
  }
  if (effects.size === 0) return [...rows];

  return rows.map((row) => {
    if (!row.key.startsWith(RED_LINE_KEY_PREFIX)) return row;
    if (row.value.trim() !== row.label.trim()) return row;
    const effect = effects.get(row.key.slice(RED_LINE_KEY_PREFIX.length));
    return effect ? { ...row, value: effect } : row;
  });
}

/**
 * 补 `display` 没投影的红线,或者宣布"补不了"。
 *
 * 调用前先用 `hasRedLineRows` 判掉已投影的情况 —— 这个函数不认已有行,直接调会
 * 和它们撞同一个 key(Compass 的 key 就是 `red_lines.<rule_id>`)。
 *
 * 回 `null` 表示这张卡有原生面板画不出来的红线,调用方应当退回 iframe。红线**缺字段**
 * (拿不到 `count`)也算补不了:分不清是真没有还是没给,而"没有红线"和"红线不明"
 * 是两件不同的事,不能替它选一个。
 *
 * 行**不带 `num`**:红线是定性事实。带上的话有可能被 `pickKeyMetrics` 的
 * `fill(r => typeof r.num === 'number')` 捞成一格数值 KPI,而那格要显示的是一长串
 * 资源名 —— 眼下 20 条 display 行排在前面轮不到它,但别把安全建立在条数上。
 */
export function backfillRedLineRows(
  result: unknown,
  labels: BackfillLabels,
): DisplayRow[] | null {
  const payload = readCardPayload(result);
  const red = payload?.red_lines;
  // 整个字段都没有 ⇒ 这份 payload 不谈红线,没有东西会被丢掉。
  if (red === undefined || red === null) return [];
  if (!isRecord(red)) return null;

  const count = red.count;
  if (typeof count !== 'number' || !Number.isFinite(count)) return null;

  if (count === 0) {
    const note = red.note;
    const value = typeof note === 'string' && note.trim() !== '' ? note : labels.redLineNone;
    return [
      {
        key: 'red_lines.status',
        section: labels.redLineSection,
        label: labels.redLineLabel,
        value,
      },
    ];
  }

  const rules = red.rules;
  // 条数对不上 ⇒ 有红线被摘掉了而我看不见,不出半张。
  if (!Array.isArray(rules) || rules.length !== count) return null;

  const rows: DisplayRow[] = [];
  for (const [i, raw] of rules.entries()) {
    if (!isRecord(raw)) return null;
    const name = raw.name;
    // 没有名字的硬约束画不出来 —— 拿 rule_id 当标签等于给人看一串 uuid。
    if (typeof name !== 'string' || name.trim() === '') return null;
    const effect = raw.effect;
    const ruleId = raw.rule_id;
    rows.push({
      key: `red_lines.${typeof ruleId === 'string' && ruleId !== '' ? ruleId : i}`,
      section: labels.redLineSection,
      label: name,
      value:
        typeof effect === 'string' && effect.trim() !== '' ? effect : labels.redLineNoEffect,
    });
  }
  return rows;
}

/**
 * 工具调用片段 → 原生面板入参,或 `null`(照旧挂 iframe)。
 *
 * `null` 的三种来路,都是"宁可丑也不能错":没有 `display` 合同(卡自己就不支持这套
 * 投影)、认不出场景(修正草稿会落到错的场景上)、有画不出的红线。
 */
export function sceneCardPanelInput(
  result: unknown,
  labels: BackfillLabels,
): SceneCardPanelInput | null {
  const rows = extractDisplayRows(result);
  if (!rows) return null;

  const source = sceneCardSource(result);
  if (!source) return null;

  // display 已经投影了红线(真机常态)⇒ 不补行,只把退化的右值填实。
  let all: DisplayRow[];
  if (hasRedLineRows(rows)) {
    all = enrichRedLineRows(rows, result);
  } else {
    const backfilled = backfillRedLineRows(result, labels);
    if (!backfilled) return null;
    all = [...rows, ...backfilled];
  }

  const narrative = extractNarrative(source, result);
  return {
    rows: all,
    narrative: narrative
      ? {
          text: narrative.text,
          ...(narrative.generatedAt ? { generatedAt: narrative.generatedAt } : {}),
        }
      : null,
    source,
  };
}
