/**
 * 从文档里提名**可核对的断言**,并把 Compass 的工具回参翻成可比对的事实。
 *
 * 分工照 deep-table-reading 那条验过的路:**模型提名,代码判定**。模型擅长
 * "这句话在讲工序归谁做",不擅长"它和线上规则一不一致" —— 后者是确定性判据。
 *
 * 只抽**今天真能核对的两类**。多抽一类核对不了的,产出的就是一堆"无法核对",
 * 淹掉真正要看的那几条。
 */
import { z } from 'zod';

import type { Assertion, Fact, Verdict } from './doc-rule-reconcile.js';

export const assertionSchema = z.object({
  assertions: z.array(
    z.object({
      kind: z.enum(['op_resource', 'capacity_k']),
      subject: z.string().min(1),
      object: z.string().min(1),
      // **必填**:核对结论要能追回文档里那一句,否则人没法判断我们读得对不对。
      quote: z.string().min(1),
    }),
  ).default([]),
});

export const ASSERTION_PROMPT = [
  '你在读一份工厂的工艺/排产说明文档。任务:抽出其中**能和排产系统核对**的事实断言。',
  '',
  '只抽这两类,别的一概不要:',
  '1. `op_resource` —— 某道工序由哪个部门/资源来做。subject=工序名,object=部门或资源名。',
  '2. `capacity_k` —— 某个资源同时能干几件(并行数/台数)。subject=资源名,object=那个数。',
  '',
  '每一条都必须带 `quote`:文档里的**原文**,一字不改。核对结果要能追回这一句。',
  '',
  '**宁缺勿滥。** 拿不准的、需要推理才能得出的、文档只是顺带提到的,一律不要抽 ——',
  '编出来的断言会在核对里变成假冲突,让人去改一个本来没问题的地方,比漏掉坏得多。',
  '文档里没有可核对的断言时,返回空数组。',
  '',
  // **必须给 JSON 的样子。** 只说字段名的话,模型会自己发明键名 —— 实测它用了
  // `type` 而不是 `kind`,14 条内容全对的断言差点因为一个键名被整批丢掉。
  '只输出 JSON,形如:',
  '{"assertions":[',
  '  {"kind":"op_resource","subject":"粗加工","object":"金工分厂","quote":"| 粗加工 | 金工分厂 |"},',
  '  {"kind":"capacity_k","subject":"120MN水压机","object":"1","quote":"同时只能压 1 件"}',
  ']}',
].join('\n');

const rowSchema = z.object({
  kind: z.enum(['op_resource', 'capacity_k']),
  subject: z.string().min(1),
  object: z.string().min(1),
  quote: z.string().min(1),
});

/**
 * 逐行解析提名结果。**坏行单独丢掉,好行留下,并报丢了几条**。
 *
 * 从前是整批 schema 校验:14 条内容全对的断言,因为模型把键名写成 `type`,
 * 一条都没留下(实测)。一条坏行毁掉整批,代价远大于收益 —— 但丢了多少必须说,
 * 悄悄丢等于谎报覆盖面。
 */
export function parseAssertions(raw: unknown): { assertions: Assertion[]; dropped: number } {
  const rows = (raw as { assertions?: unknown[] })?.assertions;
  if (!Array.isArray(rows)) return { assertions: [], dropped: 0 };
  const out: Assertion[] = [];
  let dropped = 0;
  for (const r of rows) {
    // `type` 当 `kind` 的别名:内容是对的,不该因为键名丢掉。
    const row = r && typeof r === 'object'
      ? { ...(r as Record<string, unknown>), kind: (r as { kind?: unknown; type?: unknown }).kind
          ?? (r as { type?: unknown }).type }
      : r;
    const parsed = rowSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
    else dropped++;
  }
  return { assertions: out, dropped };
}

type CompassPayload = {
  /** op_eligibility 视图:每道工序历史上在哪些设备/部门跑过 */
  eligibility?: Array<{
    op_code?: string;
    equipment?: Array<{ name?: string; share?: number }>;
    flexibility?: string;
  }>;
  /** get_resources:每个资源的并行 K */
  resources?: Array<{ name?: string; k?: number; source?: string }>;
};

/**
 * 工具回参 → 事实。**字段缺了就跳过那一条**,不补默认值 ——
 * 一个 k=0 的假事实会和文档比出一个煞有介事的"不一致"。
 */
export function factsFromCompass(payload: CompassPayload): Fact[] {
  const out: Fact[] = [];
  for (const e of payload.eligibility ?? []) {
    const resources = (e.equipment ?? [])
      .filter((x) => x?.name && typeof x.share === 'number')
      .map((x) => ({ name: String(x.name), share: Number(x.share) }));
    if (!e.op_code || !resources.length) continue;
    const flexibility =
      e.flexibility === 'locked' || e.flexibility === 'limited' || e.flexibility === 'flexible'
        ? e.flexibility
        : 'flexible';
    out.push({ kind: 'op_resource', op: String(e.op_code), resources, flexibility });
  }
  for (const r of payload.resources ?? []) {
    if (!r?.name || typeof r.k !== 'number' || !Number.isFinite(r.k)) continue;
    out.push({ kind: 'capacity_k', resource: String(r.name), k: r.k, source: String(r.source ?? '系统') });
  }
  return out;
}

export type { Assertion, Fact };

/**
 * 报给人的那一句。**冲突数打头** —— 人第一眼要看到的是"有几条对不上"。
 *
 * "全一致"和"一条断言都没抽到"必须分得开:只说"没问题",人会以为文档核对过了,
 * 而事实可能是我们什么也没读出来。
 */
export function summarizeReconcile(verdicts: Verdict[]): string {
  if (!verdicts.length) {
    return '没有抽到可核对的断言 —— 这份文档里没有"哪道工序归谁做/某个资源同时能干几件"这类能和系统对照的说法。';
  }
  const n = (s: string) => verdicts.filter((v) => v.status === s).length;
  const parts: string[] = [];
  const conflict = n('conflict');
  const partial = n('partial');
  const notFound = n('not_found');
  const unver = n('unverifiable');
  if (conflict) parts.push(`${conflict} 条对不上`);
  if (partial) parts.push(`${partial} 条部分对上`);
  if (notFound) parts.push(`${notFound} 条查不到(系统里没有对应记录,不代表文档写错)`);
  if (unver) parts.push(`${unver} 条没法机器核对`);
  const head = parts.length ? parts.join(",") : "全部一致";
  return `${head} · 一共核对了 ${verdicts.length} 条。`;
}

/**
 * 调模型从文档里提名断言。走和结晶同一条网关路径(raw /chat/completions +
 * `response_format: json_object`),**校验不过就抛,不返回半成品** ——
 * 一份字段缺失的断言表会在对照里变成一堆"无法核对",看着像做过。
 */
export async function extractAssertions(
  tenantId: string,
  text: string,
): Promise<{ assertions: Assertion[]; dropped: number }> {
  const [{ DEFAULT_MODEL, getModelConfig }, { applyTenantModelSettings }] = await Promise.all([
    import('@veylin/runtime'),
    import('./model-settings-store.js'),
  ]);
  await applyTenantModelSettings(tenantId);
  const cfg = getModelConfig(DEFAULT_MODEL);
  if (!cfg.apiKey) throw new Error('没有配置模型,无法从文档里抽断言');

  const res = await fetch(`${cfg.url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.modelId,
      messages: [
        { role: 'system', content: ASSERTION_PROMPT },
        { role: 'user', content: text.slice(0, 24_000) },
      ],
      // 提名要稳:同一份文档两次抽出不同的断言,对照结论就没法信。
      temperature: 0,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`抽断言失败(HTTP ${res.status})`);
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = body.choices?.[0]?.message?.content;
  if (!raw) throw new Error('模型没有返回内容');
  const { assertions, dropped } = parseAssertions(JSON.parse(raw));
  if (!assertions.length && dropped) {
    throw new Error(`模型返回了 ${dropped} 条断言,但没有一条合规 —— 这次没抽到可核对的东西。`);
  }
  return { assertions, dropped };
}
