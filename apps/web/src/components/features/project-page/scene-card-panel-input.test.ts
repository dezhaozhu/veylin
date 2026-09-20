import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  backfillRedLineRows,
  enrichRedLineRows,
  hasRedLineRows,
  sceneCardPanelInput,
  sceneCardSource,
  type BackfillLabels,
} from './scene-card-panel-input';

const LABELS: BackfillLabels = {
  redLineSection: '红线规则 L1',
  redLineLabel: '标定状态',
  redLineNone: '尚未标定',
  redLineNoEffect: '未说明作用范围',
};

/** 真机 guolu 的那一条(字段名照抄,别改成猜的)。 */
const REAL_RULE = {
  rule_id: '08b3e253-6972-4640-b580-f44e768a1b8c',
  name: 'classless 外协 fallback (priority 10, only catches classes with no per-class rule)',
  effect: '吨/月 (monthly_weight) → 上锅, 都江电力, 中航, 金山, 西汽, 山东博宇',
};

/** 真机 shangzhong:红线 0 条,于是 `display` 里一行红线都没有。 */
const card = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  tenant: 'shangzhong',
  display: [
    { key: 'problem.orders', section: '问题结构', label: '订单', value: '4601 单', num: 4601 },
    { key: 'rules.active', section: '规则健康', label: '活跃规则', value: '96 条', num: 96 },
  ],
  narrative: { text: '本场景为……', generated_at: '2026-09-14T00:45:49Z' },
  red_lines: { rules: [], count: 0, note: '尚未标定任何红线(L1)。' },
  ...over,
});

/** 真机 guolu:红线 1 条,**`display` 自己就带着它**(注意 value 和 label 同文)。 */
const cardWithRedLine = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  card({
    tenant: 'guolu',
    display: [
      { key: 'problem.orders', section: '问题结构', label: '订单', value: '7219 单', num: 7219 },
      {
        key: `red_lines.${REAL_RULE.rule_id}`,
        section: '红线',
        label: REAL_RULE.name,
        value: REAL_RULE.name,
      },
    ],
    red_lines: { rules: [REAL_RULE], count: 1 },
    ...over,
  });

describe('sceneCardSource', () => {
  /** 实测传 source:'guolu' 调回来的是 tenant:'shangzhong' —— 会话钉定覆盖了参数。
   *  信 args 的话修正草稿会写着另一个场景的名字,基线也会存错键。 */
  it('以 payload 的 tenant 为准', () => {
    assert.equal(sceneCardSource(card()), 'shangzhong');
  });

  it('剥得开 MCP 的三种 envelope', () => {
    assert.equal(sceneCardSource({ structuredContent: card() }), 'shangzhong');
    assert.equal(
      sceneCardSource({ content: [{ type: 'text', text: JSON.stringify(card()) }] }),
      'shangzhong',
    );
  });

  it('认不出场景就说认不出,不猜', () => {
    assert.equal(sceneCardSource(card({ tenant: '' })), null);
    assert.equal(sceneCardSource(card({ tenant: undefined })), null);
    assert.equal(sceneCardSource(null), null);
  });
});

describe('hasRedLineRows', () => {
  /** 一开始我拿红线 0 条的租户下了结论,误以为合同不投影红线,写成"有红线就退回
   *  iframe" —— 真机上于是永远走不到原生那条路,界面看不出任何变化。 */
  it('认出 display 自己带的红线行', () => {
    assert.equal(hasRedLineRows([{ key: `red_lines.${REAL_RULE.rule_id}`, section: '红线', label: 'x', value: 'y' }]), true);
    assert.equal(hasRedLineRows([{ key: 'rules.active', section: '规则健康', label: 'x', value: 'y' }]), false);
    assert.equal(hasRedLineRows([]), false);
  });
});

describe('backfillRedLineRows', () => {
  /** display 不投影红线,直接渲染会把它整节丢掉。 */
  it('零条红线补成一行,带上 payload 自己的说明', () => {
    const rows = backfillRedLineRows(card(), LABELS);
    assert.equal(rows?.length, 1);
    assert.equal(rows?.[0]?.section, '红线规则 L1');
    assert.equal(rows?.[0]?.value, '尚未标定任何红线(L1)。');
  });

  it('payload 没给说明时用兜底文案,不留空值', () => {
    const rows = backfillRedLineRows(card({ red_lines: { count: 0 } }), LABELS);
    assert.equal(rows?.[0]?.value, '尚未标定');
  });

  /** 只在 display 没投影时才走到这里。规则名当标签,作用范围当值。 */
  it('display 没投影时每条红线补一行,用真机的字段名', () => {
    const rows = backfillRedLineRows(card({ red_lines: { count: 1, rules: [REAL_RULE] } }), LABELS);
    assert.equal(rows?.length, 1);
    assert.equal(rows?.[0]?.key, `red_lines.${REAL_RULE.rule_id}`);
    assert.equal(rows?.[0]?.label, REAL_RULE.name);
    assert.equal(rows?.[0]?.value, REAL_RULE.effect);
  });

  /** 定性事实。带 num 有可能被 pickKeyMetrics 捞成数值 KPI,而那格要显示一长串资源名。 */
  it('红线行不带 num', () => {
    const rows = backfillRedLineRows(card({ red_lines: { count: 1, rules: [REAL_RULE] } }), LABELS);
    assert.equal(rows?.[0]?.num, undefined);
    assert.equal(backfillRedLineRows(card(), LABELS)?.[0]?.num, undefined);
  });

  it('没写 effect 用兜底文案 —— 空着看不出是没有还是没给', () => {
    const rows = backfillRedLineRows(
      card({ red_lines: { count: 1, rules: [{ rule_id: 'r1', name: '某红线' }] } }),
      LABELS,
    );
    assert.equal(rows?.[0]?.value, '未说明作用范围');
  });

  it('缺 rule_id 就用下标当键,不丢这条规则', () => {
    const rows = backfillRedLineRows(
      card({ red_lines: { count: 1, rules: [{ name: '某红线', effect: '吨/月' }] } }),
      LABELS,
    );
    assert.equal(rows?.[0]?.key, 'red_lines.0');
  });

  /** 红线是硬约束 L1,说不清就整段交回 iframe,不出半张。 */
  it('条数和 count 对不上就交回 iframe —— 有东西被摘掉了而我看不见', () => {
    assert.equal(
      backfillRedLineRows(card({ red_lines: { count: 3, rules: [REAL_RULE] } }), LABELS),
      null,
    );
    assert.equal(backfillRedLineRows(card({ red_lines: { count: 1 } }), LABELS), null);
  });

  it('规则没有名字就交回 iframe —— 拿 uuid 当标签等于没画', () => {
    assert.equal(
      backfillRedLineRows(card({ red_lines: { count: 1, rules: [{ rule_id: 'r1' }] } }), LABELS),
      null,
    );
    assert.equal(
      backfillRedLineRows(card({ red_lines: { count: 1, rules: ['nope'] } }), LABELS),
      null,
    );
  });

  /** "没有红线"和"红线不明"是两件事,不能替它选一个。 */
  it('拿不到 count 也算补不了', () => {
    assert.equal(backfillRedLineRows(card({ red_lines: { rules: [] } }), LABELS), null);
    assert.equal(backfillRedLineRows(card({ red_lines: 'nope' }), LABELS), null);
  });

  /** 整个字段都没有 ⇒ 这份 payload 不谈红线,没有东西会被丢掉。 */
  it('压根没有 red_lines 字段则无需回补', () => {
    assert.deepEqual(backfillRedLineRows(card({ red_lines: undefined }), LABELS), []);
  });
});

describe('enrichRedLineRows', () => {
  const redRow = (value: string) => ({
    key: `red_lines.${REAL_RULE.rule_id}`,
    section: '红线',
    label: REAL_RULE.name,
    value,
  });

  /** Compass 投影时左右两边填的是同一句规则名,详情里那行等于把 70 字长文念两遍。 */
  it('左右同文的红线行换成 effect', () => {
    const rows = enrichRedLineRows([redRow(REAL_RULE.name)], cardWithRedLine());
    assert.equal(rows[0]?.value, REAL_RULE.effect);
    assert.equal(rows[0]?.label, REAL_RULE.name, '标签还是规则名');
  });

  it('Compass 在那行说了别的话就不改写 —— value 是它的合同', () => {
    const rows = enrichRedLineRows([redRow('已于 9 月停用')], cardWithRedLine());
    assert.equal(rows[0]?.value, '已于 9 月停用');
  });

  it('对不上 rule_id、没有 effect、顶层说不清,都保持原样', () => {
    assert.equal(
      enrichRedLineRows([redRow(REAL_RULE.name)], cardWithRedLine({ red_lines: 'nonsense' }))[0]
        ?.value,
      REAL_RULE.name,
    );
    assert.equal(
      enrichRedLineRows(
        [redRow(REAL_RULE.name)],
        cardWithRedLine({ red_lines: { count: 1, rules: [{ rule_id: 'other', effect: '别的' }] } }),
      )[0]?.value,
      REAL_RULE.name,
    );
    assert.equal(
      enrichRedLineRows(
        [redRow(REAL_RULE.name)],
        cardWithRedLine({ red_lines: { count: 1, rules: [{ rule_id: REAL_RULE.rule_id }] } }),
      )[0]?.value,
      REAL_RULE.name,
    );
  });

  it('红线以外的行一概不碰', () => {
    const other = { key: 'problem.orders', section: '问题结构', label: '订单', value: '7219 单' };
    assert.deepEqual(enrichRedLineRows([other], cardWithRedLine())[0], other);
  });
});

describe('sceneCardPanelInput', () => {
  it('凑齐了就给出原生面板的入参,红线接在 display 行后面', () => {
    const input = sceneCardPanelInput(card(), LABELS);
    assert.equal(input?.source, 'shangzhong');
    assert.equal(input?.rows.length, 3);
    assert.equal(input?.rows.at(-1)?.key, 'red_lines.status');
    assert.equal(input?.narrative?.text, '本场景为……');
    assert.equal(input?.narrative?.generatedAt, '2026-09-14T00:45:49Z');
  });

  it('没有 display 合同就走 iframe —— 这张卡不支持这套投影', () => {
    assert.equal(sceneCardPanelInput(card({ display: undefined }), LABELS), null);
    assert.equal(sceneCardPanelInput(card({ display: [] }), LABELS), null);
  });

  it('认不出场景就走 iframe —— 修正草稿会落到错的场景上', () => {
    assert.equal(sceneCardPanelInput(card({ tenant: '' }), LABELS), null);
  });

  it('display 没投影、而红线又画不出来时走 iframe', () => {
    assert.equal(sceneCardPanelInput(card({ red_lines: { count: 1 } }), LABELS), null);
  });

  /** guolu 真机:display 自己带着红线 ⇒ 什么都不补,直接走原生。
   *  这条是"看不出变化"那个 bug 的回归测试。 */
  it('display 已带红线时原样走原生,不补也不重复', () => {
    const input = sceneCardPanelInput(cardWithRedLine(), LABELS);
    assert.equal(input?.source, 'guolu');
    assert.equal(input?.rows.length, 2, '行数变了说明补了一份重复的');
    const red = input!.rows.filter((r) => r.key.startsWith('red_lines.'));
    assert.equal(red.length, 1, `红线行重复了 ${red.length} 份`);
    assert.equal(red[0]?.section, '红线');
    assert.equal(red[0]?.value, REAL_RULE.effect, '右值还是规则名的话,那行就念了两遍');
  });

  /** 顶层 red_lines 说不清,但 display 已经把红线投影出来了 ⇒ 没有东西会丢,照走原生。 */
  it('display 已带红线时不再去追究顶层 red_lines 的形状', () => {
    const input = sceneCardPanelInput(cardWithRedLine({ red_lines: 'nonsense' }), LABELS);
    assert.equal(input?.rows.length, 2);
  });

  it('没有 narrative 不影响走原生', () => {
    const input = sceneCardPanelInput(card({ narrative: { status: 'pending' } }), LABELS);
    assert.equal(input?.narrative, null);
    assert.equal(input?.rows.length, 3);
  });

  /** 顶层 note 实物里是「这里不对?直接在对话里指出」那段界面提示语,不是事实。
   *  补进去等于把刚收掉的重复提示又请回来。 */
  it('顶层 note 不当数据补进去', () => {
    const input = sceneCardPanelInput(card({ note: '这里不对?直接在对话里指出。' }), LABELS);
    assert.ok(!input?.rows.some((r) => r.value.includes('这里不对')));
  });
});
