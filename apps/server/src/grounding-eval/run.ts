/**
 * 接地评测采集器 —— 手动跑,不进测试套件(打真网关、有成本、结果带随机性;
 * 混进 229 个确定性测试里就是随机红灯,这是 compass_eval 的第二条设计约束)。
 *
 *   node --import tsx src/grounding-eval/run.ts --label after
 *   VEYLIN_COMPASS_GROUNDING=0 node --import tsx src/grounding-eval/run.ts --label before
 *   node --import tsx src/grounding-eval/run.ts --compare before after
 *
 * 前置条件、SSE 事件结构、租户怎么选 —— 见同目录 README.md，全部是探针
 * (2026-08-11)的**实测**结果，不是照抄计划里的猜测。三处偏离计划骨架，
 * 全部由探针逼出来，理由写在各自的注释里：
 *
 * 1. `tool-output-available` 不带 `toolName`（计划的骨架假设它有）——
 *    工具名只在 `tool-input-start`/`tool-input-available` 里出现，必须靠
 *    `toolCallId` 事先记下来，产出时再查表对上。
 * 2. 租户不是"整个采集器进程只能打一个厂"，而是"每个 threadId 钉一个项目"
 *    （POST /api/project）。于是不需要计划里设想的 VEYLIN_EVAL_TENANT
 *    "单租户跑两遍再合并"退路 —— 采集器本来就已经给每个
 *    (case, tenant, attempt) 开一个新 threadId，钉对项目就行。
 *    VEYLIN_EVAL_TENANT 仍保留，但只是"这次跑只挑一个厂"的可选窄化，
 *    不是必需的工作量。
 * 3. 探针实测到模型在没有接地工具引导时可能自己分页扫全表（30,923 行的
 *    schedule 表，kimi-k2.7-code 一度选了"自己读 155 页去算平均"而不是调用
 *    诊断工具），单轮可能非常久（后续正式跑里模型改走了 get_cockpit 等接地
 *    工具，见 task-7-report.md）。加了 VEYLIN_EVAL_TIMEOUT_MS 兜底，默认
 *    8 分钟，而不是裸 fetch 不设超时。
 */
// 复用 server.ts 同一条 .env 加载路径(仓库根目录 .env),否则 `model` 字段会
// 读到采集器自己 shell 里的空 VEYLIN_MODEL,而不是 server 实际在用的值 ——
// 冒烟跑时踩到过这个坑(见 README.md「跑法」)。dotenv 默认不覆盖已经在环境
// 里的变量,所以命令行前缀的 VEYLIN_EVAL_* 依然优先。
import '../env.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GROUNDING_CASES, type GroundingCase } from './cases.js';
import { runChecks, type ToolCall } from './checks.js';

const BASE = process.env['VEYLIN_EVAL_BASE'] ?? 'http://127.0.0.1:8787';
const ATTEMPTS = Number(process.env['VEYLIN_EVAL_ATTEMPTS'] ?? '3');
/** 单轮上限。探针实测到模型可能自己分页扫全表，一轮能拖到几分钟。 */
const TIMEOUT_MS = Number(process.env['VEYLIN_EVAL_TIMEOUT_MS'] ?? '480000');
/** 可选:只跑一个厂(窄化,不是必需 —— 见文件头注释 2)。 */
const ONLY_TENANT = process.env['VEYLIN_EVAL_TENANT'];
const OUT_DIR = resolve(process.cwd(), 'eval-runs');

type Sample = {
  sampleId: string;
  caseId: string;
  tenant: string;
  attempt: number;
  text: string;
  toolCalls: ToolCall[];
  violations: Array<{ check: string; detail: string }>;
  numbersToReview: string[];
};

type ProjectRow = { id: string; sources: string[]; managed: boolean };

/**
 * 租户怎么选(README.md「租户怎么选」章节的实测结论):会话钉定到的是一个
 * **项目**(POST /api/project { threadId, project: <projectId> }),不是直接
 * 传租户名。每个被授权的场景(guolu/shangzhong)都有一个 reconciler 自动建的
 * 单场景 managed 默认项目 —— 这里按 `managed && sources.length === 1` 挑出
 * 那一个,用 `sources[0]`(即租户名)当 key。
 *
 * 找不到某个租户对应的项目,不臆造:调用方拿到 undefined 就该跳过并警告,
 * 不能编一个打不到的 tenant 维度进结果文件(计划原文原话)。
 */
async function resolveTenantProjects(): Promise<Map<string, string>> {
  const res = await fetch(`${BASE}/api/projects`);
  if (!res.ok) throw new Error(`GET /api/projects ${res.status}`);
  const body = (await res.json()) as { projects?: ProjectRow[] };
  const map = new Map<string, string>();
  for (const p of body.projects ?? []) {
    if (p.managed && p.sources.length === 1) {
      const tenant = p.sources[0];
      if (tenant) map.set(tenant, p.id);
    }
  }
  return map;
}

/** 把某个 threadId 钉到某个项目上 —— 之后这个 thread 打的 compass 工具就只见得到该项目的场景。 */
async function pinThreadToProject(threadId: string, projectId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/project`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ threadId, project: projectId }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || body.ok !== true) {
    throw new Error(`POST /api/project failed for ${threadId} -> ${projectId}: ${res.status} ${body.error ?? ''}`);
  }
}

/**
 * 解析一轮 SSE,取最终文本与工具返回。事件名与字段是 Step 1 探针
 * (2026-08-11,AI SDK v6 UI message stream,见 README.md)的实测结果:
 *
 * - 文本:`text-delta` 的 `delta`(string)—— 按流出现顺序拼接即可,id 会
 *   跨 step 复位为 "txt-0",不能按 id 分桶,只能按到达顺序 append。
 * - 工具调用名:`tool-input-start` / `tool-input-available` 的 `toolName`,
 *   用 `toolCallId` 存一张表。
 * - 工具返回:`tool-output-available` 的 `output` —— **不带 toolName**,
 *   必须用上面那张表按 `toolCallId` 查回工具名。
 * - 工具报错:`tool-output-error` 的 `errorText`(没有 output)——同样按
 *   toolCallId 查名,包成 `{ error: errorText }` 当 result,不静默丢弃
 *   (否则一次失败的调用在结果里就完全消失,看起来像没调过)。
 * - 流级错误(如模型端点挂了):顶层 `type: "error"` 的 `errorText` ——
 *   前置到 text 里当一段可读标记,而不是让调用方拿到一个空 text 却不知道
 *   为什么。
 */
async function askOnce(question: string, threadId: string): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let raw: string;
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: question }], threadId }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`chat ${res.status}`);
    raw = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const text: string[] = [];
  const toolCalls: ToolCall[] = [];
  const toolNameByCallId = new Map<string, string>();

  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = String(evt['type'] ?? '');
    const toolCallId = typeof evt['toolCallId'] === 'string' ? evt['toolCallId'] : undefined;

    if (type === 'text-delta' && typeof evt['delta'] === 'string') {
      text.push(evt['delta']);
      continue;
    }
    if ((type === 'tool-input-start' || type === 'tool-input-available') && toolCallId) {
      const toolName = typeof evt['toolName'] === 'string' ? evt['toolName'] : undefined;
      if (toolName) toolNameByCallId.set(toolCallId, toolName);
      continue;
    }
    if (type === 'tool-output-available' && toolCallId) {
      toolCalls.push({ name: toolNameByCallId.get(toolCallId) ?? 'unknown', result: evt['output'] });
      continue;
    }
    if (type === 'tool-output-error' && toolCallId) {
      toolCalls.push({
        name: toolNameByCallId.get(toolCallId) ?? 'unknown',
        result: { error: evt['errorText'] },
      });
      continue;
    }
    if (type === 'error') {
      text.unshift(`[stream error] ${String(evt['errorText'] ?? '')}\n`);
      continue;
    }
  }
  return { text: text.join(''), toolCalls };
}

async function runCase(
  c: GroundingCase,
  tenant: string,
  projectId: string,
  label: string,
): Promise<Sample[]> {
  const out: Sample[] = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const threadId = `eval-${label}-${c.id}-${tenant}-${attempt}-${Date.now()}`;
    const sampleId = `${c.lane}:${c.id}:${tenant}:${attempt}`;
    try {
      await pinThreadToProject(threadId, projectId);
      const turn = await askOnce(c.question, threadId);
      const report = runChecks({ ...turn, caseId: c.id }, { forbidSolve: c.forbidSolve === true });
      out.push({
        sampleId,
        caseId: c.id,
        tenant,
        attempt,
        text: turn.text,
        toolCalls: turn.toolCalls,
        violations: report.violations,
        numbersToReview: report.numbersToReview,
      });
    } catch (err) {
      // 探针实测到模型可能在没有接地工具引导时自己分页扫全表,单轮可能拖到
      // VEYLIN_EVAL_TIMEOUT_MS 触发 AbortController —— 一次超时/网络错误不该
      // 掐死整个 sweep(8 个 case × 最多 2 个租户 × N attempts),记一条可见的
      // 失败样本,继续跑剩下的。空 toolCalls/violations 不会被误判成"过了判据"
      // ——runChecks 对空 text 本来就不会命中任何硬判据,人工看 text 里的
      // `[collector error]` 前缀就知道这条不是真实答案。
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[eval] ${sampleId} 失败: ${message}`);
      out.push({
        sampleId,
        caseId: c.id,
        tenant,
        attempt,
        text: `[collector error] ${message}`,
        toolCalls: [],
        violations: [],
        numbersToReview: [],
      });
    }
    if (c.needsCentralRole) await discardDraft(threadId);
  }
  return out;
}

/** G5 会产生草稿。不 discard 就会污染下一次跑,也污染真人的工作区。 */
async function discardDraft(threadId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/schedule-edit/discard`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ threadId }),
  });
  if (!res.ok) console.warn(`[eval] discard 失败 ${res.status} —— 草稿可能残留,手动清理 (threadId=${threadId})`);
}

function compare(aLabel: string, bLabel: string): void {
  const load = (l: string) =>
    JSON.parse(readFileSync(resolve(OUT_DIR, `grounding-${l}.json`), 'utf8')) as { samples: Sample[] };
  const a = new Map(load(aLabel).samples.map((s) => [s.sampleId, s]));
  const b = new Map(load(bLabel).samples.map((s) => [s.sampleId, s]));
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const av = a.get(id)?.violations.map((v) => v.check).sort() ?? null;
    const bv = b.get(id)?.violations.map((v) => v.check).sort() ?? null;
    if (av === null || bv === null) {
      console.log(`${id}: 只在 ${av === null ? bLabel : aLabel} 出现(样本集改了?)`);
    } else if (JSON.stringify(av) !== JSON.stringify(bv)) {
      console.log(`${id}: ${aLabel}=[${av.join(',')}] → ${bLabel}=[${bv.join(',')}]`);
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmp = argv.indexOf('--compare');
  if (cmp >= 0) {
    const a = argv[cmp + 1];
    const b = argv[cmp + 2];
    if (!a || !b) throw new Error('--compare 需要两个 label');
    compare(a, b);
    return;
  }
  const labelIdx = argv.indexOf('--label');
  const label = labelIdx >= 0 ? argv[labelIdx + 1] : undefined;
  if (!label) throw new Error('需要 --label <name>');

  const tenantProjects = await resolveTenantProjects();

  const samples: Sample[] = [];
  for (const c of GROUNDING_CASES) {
    const tenants = ONLY_TENANT ? c.tenants.filter((t) => t === ONLY_TENANT) : c.tenants;
    for (const tenant of tenants) {
      const projectId = tenantProjects.get(tenant);
      if (!projectId) {
        // 打不到就不编 —— 宁可漏一格,不能让结果文件声称覆盖了一个实际上没打到的租户。
        console.warn(`[eval] ${c.id}: 找不到 tenant=${tenant} 的托管默认项目,跳过(不臆造结果)`);
        continue;
      }
      console.log(`[eval] ${c.id} @ ${tenant} ×${ATTEMPTS}`);
      samples.push(...(await runCase(c, tenant, projectId, label)));
    }
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const file = resolve(OUT_DIR, `grounding-${label}.json`);
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        label,
        model: process.env['VEYLIN_MODEL'] ?? null,
        groundingEnabled: process.env['VEYLIN_COMPASS_GROUNDING'] !== '0',
        samples,
      },
      null,
      2,
    )}\n`,
  );
  const red = samples.filter((s) => s.violations.length > 0).length;
  console.log(`[eval] ${samples.length} 个样本,${red} 个有硬违规 → ${file}`);
}

void main();
