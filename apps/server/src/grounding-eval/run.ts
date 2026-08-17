/**
 * 接地评测采集器 —— 手动跑,不进测试套件(打真网关、有成本、结果带随机性;
 * 混进 229 个确定性测试里就是随机红灯,这是 compass_eval 的第二条设计约束)。
 *
 *   node --import tsx src/grounding-eval/run.ts --label after --grounding on
 *   VEYLIN_COMPASS_GROUNDING=0 node --import tsx src/grounding-eval/run.ts --label before --grounding off
 *   node --import tsx src/grounding-eval/run.ts --compare before after
 *
 * `--grounding on|off` 是必填的操作员断言(哪臂),不是采集器测出来的——见
 * `RunFile.groundingArmAsserted` 的注释:采集器读不到 server 进程的
 * `VEYLIN_COMPASS_GROUNDING`(两边是不同进程,值可以不一致——2026-08-11 基线跑
 * 踩过这个真实反例,忘在采集器命令行也加这个变量,结果文件里旧的
 * `groundingEnabled` 字段就静默撒了谎),必须由人在命令行上明确声明,真正的
 * 核实要靠独立证据(server 侧日志之类),不能靠这个字段自证。
 *
 * 前置条件、SSE 事件结构、租户怎么选 —— 见同目录 README.md，全部是探针
 * (2026-08-11)的**实测**结果，不是照抄计划里的猜测。偏离计划骨架的地方，
 * 全部由探针或第一轮审查逼出来，理由写在各自的注释里：
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
 * 4.（第一轮审查, Finding 1）单次 `discardDraft` 失败/`pinThreadToProject`+
 *    `askOnce` 之外的任何异常，都不该把已经花真钱采到的样本全部丢掉：
 *    `main()` 有 `.catch()`，结果文件按 case 增量落盘（带 `partial` 标记），
 *    `discardDraft` 的失败被记进样本的 `error` 字段而不是让异常往上传。
 * 5.（第一轮审查, Finding 2）一次 `pinThreadToProject`/`askOnce` 失败产出的
 *    样本，结构上必须和"真的跑完且零违规"区分得开——见下面 `Sample.error`。
 * 6.（第二轮审查, Finding A）`VEYLIN_EVAL_CASES`/`VEYLIN_EVAL_TENANT` 传一个不
 *    存在的 case id / 租户名，不该悄悄跑出 0 个样本还退出码 0——那和"跑完了
 *    什么问题都没有"从输出上分不清。两个过滤器的值都在跑之前校验，未知值直接
 *    报错退出；即使过滤器都合法，sweep 最终 0 个样本也当失败处理，不当成
 *    "干净"结果打印或落盘。
 * 7.（第二轮审查, Finding B）`discardDraft` 原来的 `fetch` 没有超时——如果
 *    server 是"挂起没响应"而不是"直接拒连"(正是有人会去按 Ctrl-C 的场景)，
 *    SIGINT/SIGTERM 处理器会卡在 `await discardDraft(...)` 上永远退不出去，
 *    比修复前(Node 默认处理器,Ctrl-C 立即退)还糟。现在 `discardDraft` 自己有
 *    超时(`AbortController`)，信号处理器额外传一个更短的超时；连按两次
 *    Ctrl-C 会跳过等待直接退出。
 * 8.（跟进,补 G9 的收尾)cases.ts 新增的 G9 会合法调用 `propose_constraint`，
 *    产生一个治理提案——不是 G5 那种编辑草稿，没有 agent-facing 的撤销 API，
 *    采集器不碰数据库去清它。改成在 `main()` 结尾扫一遍这次 sweep 里的
 *    `propose_constraint` 结果，把 `proposal_id` 收集起来打印，交给操作员
 *    手动清理——见 `proposalIdsFrom` 和它调用处的注释(含对 compass 源码核实
 *    过的"重复跑不累积"结论)。
 */
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
/** 可选:只跑指定的 case id(逗号分隔),给便宜的手动验证/调试用,不改变全量跑法。 */
const ONLY_CASES = process.env['VEYLIN_EVAL_CASES']
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
/** discardDraft 的默认超时(正常路径,runCase 里每次 G5 attempt 后都会调一次)。 */
const DISCARD_TIMEOUT_MS = Number(process.env['VEYLIN_EVAL_DISCARD_TIMEOUT_MS'] ?? '30000');
/**
 * SIGINT/SIGTERM 处理器里补一次 discard 时用的超时——刻意比 DISCARD_TIMEOUT_MS
 * 短很多:这是"尽力而为"的清理,不是保证,不能让用户等太久按不动第二次 Ctrl-C
 * (第二轮审查 Finding B)。不做成环境变量:就是给"人正在等着退出"这个场景用的,
 * 不是需要按跑法调的旋钮。
 */
const SIGNAL_DISCARD_TIMEOUT_MS = 5_000;
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
  /**
   * null = 这次 attempt 真的跑完了一轮对话并被判据评过(text/toolCalls/
   * violations 可信)。非 null = 采集本身出了问题(pin 失败/chat 超时或报错/
   * 草稿 discard 失败)—— text/violations 不代表模型的真实回答,不能算进
   * "零违规"的统计,也不该在 --compare 里被当成"和上次一样"。
   *
   * 第一轮审查 Finding 2:此前用 `text` 里的 `[collector error]` 前缀当唯一
   * 标记,是自由文本,汇总时的 `violations.length > 0` 判红逻辑和
   * `compare()` 的 diff 都不认它,一次 pin 失败的样本会被算成"零违规的
   * 干净通过"。这个字段就是让每个消费者都能机械地把两者分开。
   */
  error: string | null;
};

type RunFile = {
  label: string;
  model: string | null;
  /**
   * 操作员断言,不是测量值。这个字段过去叫 `groundingEnabled`,值取自采集器
   * 自己进程的 `process.env['VEYLIN_COMPASS_GROUNDING']`——但接地开关是
   * SERVER 进程读的,采集器是另一个进程,两边环境可以不一致(采集器命令行忘
   * 加这个变量、只在启 server 时加了,是本刀实测踩到的真实反例)。采集器
   * 没有任何办法从外部观测另一个进程的环境变量,继续假装能读就是在结果文件
   * 里撒谎。现在改成 `--grounding on|off` 必填命令行参数,字段改名成
   * `groundingArmAsserted` 读起来就是"操作员声称这次是哪臂",不是"采集器测出
   * 来的"——真正的verification 必须靠独立证据(比如 server 侧日志),见
   * task-8-report.md。
   */
  groundingArmAsserted: 'on' | 'off';
  /** true = 这次 sweep 还没跑完(增量落盘中途)。见文件头注释 4。 */
  partial: boolean;
  samples: Sample[];
};

type ProjectRow = { id: string; sources: string[]; managed: boolean };

const KNOWN_CASE_IDS = new Set(GROUNDING_CASES.map((c) => c.id));
const KNOWN_TENANTS = new Set(GROUNDING_CASES.flatMap((c) => c.tenants));

/**
 * 第二轮审查 Finding A:`VEYLIN_EVAL_CASES`/`VEYLIN_EVAL_TENANT` 传一个不存在的
 * case id / 租户名,在过滤逻辑里就是"这条 case 没匹配上,跳过"——静默产出 0 个
 * 样本,退出码却是 0,和"跑完了,啥问题都没有"从命令行输出上分不清。这在
 * `cases.ts` 改名/删 case 之后、真跑一次昂贵的基线之前尤其危险:一个手滑的
 * case id 会让人以为跑过了。未知值在跑之前就报错退出,不当成"合法但恰好匹配
 * 不到东西"的空选择。
 */
function validateFilters(): void {
  if (ONLY_CASES) {
    const unknown = ONLY_CASES.filter((id) => !KNOWN_CASE_IDS.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `VEYLIN_EVAL_CASES 里有未知的 case id: ${unknown.join(',')}` +
          `(已知: ${[...KNOWN_CASE_IDS].join(',')})`,
      );
    }
  }
  if (ONLY_TENANT && !KNOWN_TENANTS.has(ONLY_TENANT)) {
    throw new Error(
      `VEYLIN_EVAL_TENANT=${ONLY_TENANT} 不是任何 case 声明过的租户` +
        `(已知: ${[...KNOWN_TENANTS].join(',')})`,
    );
  }
  // 数字旋钮同样要在花一分钱之前校验:字符串→数字用 Number() 硬转,拼错单位
  // (比如把 VEYLIN_EVAL_TIMEOUT_MS 写成 "8min")解析成 NaN 时,setTimeout 会
  // 立刻触发,每一轮 chat 都会瞬间 abort——一整个 sweep 全部跑成失败样本,但
  // 退出码是 0、看起来"跑完了"。id 类过滤器已经在上面 fail loud,数字类旋钮
  // 之前没有,这里补齐同一等级的校验。
  for (const [name, value] of [
    ['VEYLIN_EVAL_ATTEMPTS', ATTEMPTS],
    ['VEYLIN_EVAL_TIMEOUT_MS', TIMEOUT_MS],
    ['VEYLIN_EVAL_DISCARD_TIMEOUT_MS', DISCARD_TIMEOUT_MS],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        `${name} 必须解析成一个正数,读到的原始值是 ${JSON.stringify(process.env[name])}` +
          `,解析结果是 ${value}——多半是打错了单位或格式(比如写成 "8min" 而不是毫秒数)`,
      );
    }
  }
}

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

/**
 * G5 唯一会产生编辑草稿的 threadId,在"这一 attempt 需要 discard"到"已经
 * discard 过"之间的窗口里保持非空 —— SIGINT/SIGTERM 处理器靠它判断退出前
 * 要不要补一次 discard(第一轮审查 Minor 1)。
 */
let pendingDiscardThreadId: string | null = null;

/**
 * 第二轮审查 Finding B:第一次信号"尽力而为"补一次 discard(有
 * SIGNAL_DISCARD_TIMEOUT_MS 兜底,不会永远卡住),但如果用户等不及、再按一次
 * Ctrl-C(或再发一次 SIGTERM),必须立刻退出,不管补 discard 有没有做完——
 * "退不出程序"永远不该是这个采集器能造成的后果，最坏情况只是草稿没清干净，
 * 手动清理还在(见 README「中断怎么办」)。
 */
let signalHandled = false;

function installSignalHandlers(): void {
  const onSignal = (signal: NodeJS.Signals) => {
    if (signalHandled) {
      console.warn(`[eval] 再次收到 ${signal},不再等 discard,立刻退出`);
      process.exit(1);
    }
    signalHandled = true;
    void (async () => {
      if (pendingDiscardThreadId) {
        console.warn(
          `[eval] 收到 ${signal},最多等 ${SIGNAL_DISCARD_TIMEOUT_MS}ms 尝试补一次 discard` +
            `(threadId=${pendingDiscardThreadId};再按一次可立刻退出)`,
        );
        await discardDraft(pendingDiscardThreadId, SIGNAL_DISCARD_TIMEOUT_MS).catch(() => undefined);
      }
      process.exit(1);
    })();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
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
    if (c.needsCentralRole) pendingDiscardThreadId = threadId;

    let sample: Sample;
    try {
      await pinThreadToProject(threadId, projectId);
      const turn = await askOnce(c.question, threadId);
      const report = runChecks({ ...turn, caseId: c.id }, { forbidSolve: c.forbidSolve === true });
      sample = {
        sampleId,
        caseId: c.id,
        tenant,
        attempt,
        text: turn.text,
        toolCalls: turn.toolCalls,
        violations: report.violations,
        numbersToReview: report.numbersToReview,
        error: null,
      };
    } catch (err) {
      // 探针实测到模型可能在没有接地工具引导时自己分页扫全表,单轮可能拖到
      // VEYLIN_EVAL_TIMEOUT_MS 触发 AbortController —— 一次超时/网络错误不该
      // 掐死整个 sweep(8 个 case × 最多 2 个租户 × N attempts),记一条可见的
      // 失败样本,继续跑剩下的。`error` 非 null 这一点本身就是判据,不依赖
      // text 里的自由文本前缀(第一轮审查 Finding 2)。
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[eval] ${sampleId} 失败: ${message}`);
      sample = {
        sampleId,
        caseId: c.id,
        tenant,
        attempt,
        text: `[collector error] ${message}`,
        toolCalls: [],
        violations: [],
        numbersToReview: [],
        error: message,
      };
    }

    if (c.needsCentralRole) {
      // 不管上面成功还是失败都尝试 discard——即使 pin/ask 失败,也可能是在
      // 草稿已经开出之后才失败的(比如 discard 之前那一步网络抖动),宁可多
      // 打一次没有草稿可清的 discard,也不要漏清。
      const discardError = await discardDraft(threadId);
      pendingDiscardThreadId = null;
      if (discardError) {
        // 第一轮审查 Finding 1:discardDraft 失败不能让异常往上传把整个 sweep
        // 炸掉,但也不能被 console.warn 悄悄吞掉——记进同一个 error 字段
        // (finding 2 建的那条通道),让这条样本在汇总/对比里都显式地不算"干净"。
        sample.error = sample.error ? `${sample.error}; discard failed: ${discardError}` : `discard failed: ${discardError}`;
      }
    }
    out.push(sample);
  }
  return out;
}

/**
 * G5 会产生草稿。不 discard 就会污染下一次跑,也污染真人的工作区。
 * 返回失败原因(string)而不是抛异常 —— 调用方(runCase)决定怎么记录,housekeeping
 * 失败绝不能把整个 sweep 炸掉(第一轮审查 Finding 1)。
 */
async function discardDraft(threadId: string, timeoutMs = DISCARD_TIMEOUT_MS): Promise<string | null> {
  // 第二轮审查 Finding B:这个 fetch 原来没有超时——如果 server 是"挂起没
  // 响应"(不是直接拒连,拒连 fetch 会很快抛异常),这个 await 永远不返回。
  // 正常路径(runCase 里每次 G5 attempt 后)用 DISCARD_TIMEOUT_MS;
  // SIGINT/SIGTERM 路径传一个短得多的 SIGNAL_DISCARD_TIMEOUT_MS。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api/schedule-edit/discard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ threadId }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const message = `discard ${res.status} (threadId=${threadId})`;
      console.warn(`[eval] discard 失败 ${message} —— 草稿可能残留,手动清理`);
      return message;
    }
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[eval] discard 抛异常 ${message} (threadId=${threadId}) —— 草稿可能残留,手动清理`);
    return message;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `numbersToReview` 是软信号(半自动线索,不判红——见 checks.ts 的文档注释),
 * 这里的对比刻意只看 `violations`。这是一个已知的范围限制,不是遗漏:一次干净
 * 的 `--compare` 只保证"硬判据没变化",不保证"数字线索也没变化",人工复核
 * `numbersToReview` 仍然是必要的一步(README.md 同步记了这条)。
 */
function compare(aLabel: string, bLabel: string): void {
  const load = (l: string) =>
    JSON.parse(readFileSync(resolve(OUT_DIR, `grounding-${l}.json`), 'utf8')) as { samples: Sample[] };
  const a = new Map(load(aLabel).samples.map((s) => [s.sampleId, s]));
  const b = new Map(load(bLabel).samples.map((s) => [s.sampleId, s]));
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const sa = a.get(id);
    const sb = b.get(id);
    if (!sa || !sb) {
      console.log(`${id}: 只在 ${!sa ? bLabel : aLabel} 出现(样本集改了?)`);
      continue;
    }
    // 第一轮审查 Finding 2:采集失败的样本(error !== null)违规列表是空的
    // ([]),和"真的跑完且零违规"在这里如果只比 violations 会显示成
    // "没变化"——必须先把它单独摘出来,不能悄悄折进"unchanged"。
    if (sa.error != null || sb.error != null) {
      console.log(
        `${id}: 采集失败,不比较 —— ${aLabel}.error=${sa.error ?? '(无)'} ${bLabel}.error=${sb.error ?? '(无)'}`,
      );
      continue;
    }
    const av = sa.violations.map((v) => v.check).sort();
    const bv = sb.violations.map((v) => v.check).sort();
    if (JSON.stringify(av) !== JSON.stringify(bv)) {
      console.log(`${id}: ${aLabel}=[${av.join(',')}] → ${bLabel}=[${bv.join(',')}]`);
    }
  }
}

/**
 * G9(约束提案的合法影子求解,见 cases.ts)走 `propose_constraint` →
 * `show_shadow`,这是治理提案通道,不是 G5 那条编辑草稿通道——没有
 * agent-facing 的撤销 API,`propose_constraint` 生成的提案是治理产物,活着的
 * (`status='proposed'`),采集器不碰数据库去删它。这里只是把这次 sweep 里真的
 * 生成过的 `proposal_id` 收集起来,跑完在 main() 结尾打印,交给操作员人工清理
 * ——见调用处的清理命令。
 */
function proposalIdsFrom(samples: Sample[]): string[] {
  const ids = new Set<string>();
  for (const s of samples) {
    for (const call of s.toolCalls) {
      if (call.name !== 'propose_constraint') continue;
      const result = call.result;
      if (!result || typeof result !== 'object' || Array.isArray(result)) continue;
      const id = (result as Record<string, unknown>)['proposal_id'];
      if (typeof id === 'string') ids.add(id);
    }
  }
  return [...ids];
}

/** 落盘助手 —— main() 在每个 case×tenant 跑完后都调一次,不只在最后调一次。 */
function writeResults(
  label: string,
  groundingArm: 'on' | 'off',
  samples: Sample[],
  partial: boolean,
): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = resolve(OUT_DIR, `grounding-${label}.json`);
  const body: RunFile = {
    label,
    model: process.env['VEYLIN_MODEL'] ?? null,
    groundingArmAsserted: groundingArm,
    partial,
    samples,
  };
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return file;
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

  // 操作员断言,不是从环境变量猜的——采集器读不到 server 进程的环境,不该假装
  // 能读(见 RunFile.groundingArmAsserted 的注释)。必填,值只接受 on/off,
  // 拼错(比如传成 0/1/true/false)直接报错退出,不落盘任何文件。
  const groundingIdx = argv.indexOf('--grounding');
  const groundingArg = groundingIdx >= 0 ? argv[groundingIdx + 1] : undefined;
  if (groundingArg !== 'on' && groundingArg !== 'off') {
    throw new Error(
      `需要 --grounding on|off(操作员断言这次 server 是哪臂,采集器读不到 server 进程的环境变量,` +
        `不能替你猜;实际是哪臂必须靠独立证据核实,见 grounding-eval/README.md)。得到: ${groundingArg ?? '(未传)'}`,
    );
  }
  const groundingArm: 'on' | 'off' = groundingArg;

  // 第二轮审查 Finding A:零网络请求的快速失败,在花任何钱之前先确认过滤器
  // 拼对了。
  validateFilters();

  installSignalHandlers();

  const tenantProjects = await resolveTenantProjects();

  const samples: Sample[] = [];
  for (const c of GROUNDING_CASES) {
    if (ONLY_CASES && !ONLY_CASES.includes(c.id)) continue;
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
      // 第一轮审查 Finding 1:增量落盘。一次崩溃(不管是不是 discard 那个
      // bug)不该让已经花真钱采到的样本全部丢掉——每个 case×tenant 跑完就
      // 重写一次文件,标 partial:true,让中途中断也留一份可用的部分结果。
      writeResults(label, groundingArm, samples, true);
    }
  }

  if (samples.length === 0) {
    // 第二轮审查 Finding A:即使过滤器本身合法(比如 case 和 tenant 都存在,
    // 但这条 case 没声明这个租户,交集是空的;或者本地环境这几个租户的托管
    // 项目都没建出来),0 个样本也不能当"干净"结果打印或落盘——不写 samples:
    // [] 的"看似正常"的文件,直接报错退出,退出码非零,消息里给出下一步该查
    // 什么。
    throw new Error(
      '这次 sweep 产出了 0 个样本 —— 不当成干净结果处理。' +
        '检查 VEYLIN_EVAL_CASES/VEYLIN_EVAL_TENANT 的组合是否互相排除了' +
        '(某条 case 没声明这个租户),或者本地 /api/projects 是否缺对应租户的' +
        '托管默认项目(见上面每条 case 的 [eval] 警告)。',
    );
  }

  const file = writeResults(label, groundingArm, samples, false);
  const errored = samples.filter((s) => s.error !== null);
  const ok = samples.filter((s) => s.error === null);
  const red = ok.filter((s) => s.violations.length > 0).length;
  console.log(
    `[eval] ${samples.length} 个样本 —— ${ok.length} 个成功(${red} 个有硬违规),` +
      `${errored.length} 个采集失败(不计入违规统计) → ${file}`,
  );

  // G9 会生成约束提案(治理产物,没有 agent-facing 的撤销 API,采集器不碰数据
  // 库)——报出这次 sweep 里真的生成过的 proposal_id,交给操作员人工清理。
  //
  // 污染面对着 compass 源码核实过,不是猜的:`constraint_proposer.py:61`
  // `proposal_id = f"constraint-{case_id}-{target}-{reason}"`,其中
  // `case_id = "agent-" + target_order_id`、`target = target_order_id`、
  // `reason` 固定是 `"order_due_change"`——三段都不含 due_at/attempt 序号/
  // label/时间戳,同一个订单号在任意多次 attempt、任意多次 label、甚至任意
  // 多次完整基线重跑之间算出来的都是**同一个** proposal_id。
  // `save_or_update_proposal`(`repositories.py:1002`)对已存在且仍是
  // `'proposed'` 状态的行是原地更新、不是新插一行(只有已经 approved/rejected
  // 才会报错,那种情况下这条 case 本来也跑不下去)。也就是说:只要没人手动
  // 批准/驳回这条提案,数据库里最多留下一行,不会随着重跑次数累积——这不是
  // 传说,是读源码核实过的结论。
  const proposalIds = proposalIdsFrom(samples);
  if (proposalIds.length > 0) {
    console.log(
      `[eval] G9 这次 sweep 生成/更新了 ${proposalIds.length} 个约束提案` +
        `(同一订单号跨 attempt/跨基线重跑是同一行,不会累积,见上方注释)。` +
        `清理(本地 compass Postgres,proposals 表):\n` +
        proposalIds
          .map(
            (id) =>
              `  docker exec compass-v2-db-1 psql -U postgres -d compass ` +
              `-c "DELETE FROM proposals WHERE proposal_id = '${id}';"`,
          )
          .join('\n'),
    );
  }
}

// 只在直接跑这个文件时才启动(仿 compass-refs.ts 同款守卫)——目前没有任何地方
// import run.ts,但下一步显而易见的动作(比如给对比逻辑写单测,从 `./run.js`
// import compare()/validateFilters() 之类的纯函数)一旦发生,没有这道守卫就会让
// `npm test` 顺带跑起一整轮打真网关、花真钱的采集 sweep。
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[eval] 采集器异常退出:\n${message}`);
    process.exitCode = 1;
  });
}
