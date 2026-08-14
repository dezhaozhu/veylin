/**
 * Table provenance (Layer-4): sheet metadata gains a `source` stamp on every
 * Compass load, and table_get surfaces it + refuses rows outright when a
 * thread's project pin disagrees with a STAMPED source — the guard against the
 * real incident this closes: a workspace sheet loaded from tenant `shangzhong`
 * days ago being read by an agent in a `guolu`-pinned thread with no signal
 * (or, pre audit-fix-#2, only a soft warning it could ignore) that the rows
 * were stale/cross-tenant. Legacy unstamped sheets keep the softer
 * warn-but-still-return behavior.
 *
 * PROJECT-PIN RE-KEY (project-cognition v3, Phase B 5c — plan risk #1, the
 * highest of the phase): pins and stamps are PROJECT ids now. Sheets stamp
 * `source.project` = the pinned project's id (`source.server` = the resolved
 * toolset key, display only); `isProjectPinMismatch` compares
 * `source.project ?? legacyServerToProjectId(source.server, projects)`
 * against the project-id pin, and an unmappable stamped source hard-refuses.
 * The regression this file pins hardest: post-v3 EVERY project resolves the
 * same `'compass'` toolset key, so stamping that key would make all projects'
 * stamps identical and silently disable this check entirely — see the
 * "risk #1 regression" test below.
 *
 * In-memory only (mirrors table-tools.test.ts): DB persistence is
 * fire-and-forget/best-effort here, so no SurrealDB setup is needed. The real
 * DB round-trip lives in table-store-provenance.test.ts.
 */
import { describe, it } from 'node:test';
import { PERSONAL_SCOPE, projectScope, sheetIdFor } from './table-scope.js';

/** 测试里读连接器来源的收窄小工具(来源现在是判别式两类,见 spec §4)。 */
const conn = (s: unknown) =>
  (s ?? {}) as { server?: string; project?: string; tenant?: string; loadedAt?: string };

/** compass 装进来的表落在**那个项目**的作用域里(spec §3.4)。 */
const scheduleIdOf = (project: Project) => sheetIdFor(projectScope(project.id), 'schedule');
import assert from 'node:assert/strict';
import type { Project } from '@veylin/shared';
import { buildTableTools } from './table-tools.js';
import {
  buildTableContextBlock,
  createTableSheet,
  formatTableContextBlock,
  getTableSheetMeta,
  isProjectPinMismatch,
  isUnscopedProjectData,
  stampTableSheetSource,
} from './table-store.js';

type ToolCtx = { requestContext: { get(key: string): unknown } };

function projectFixture(id: string, name: string, sources: string[], managed = true): Project {
  return { id, tenantId: 'tenant-prov', name, sources, managed, enabled: true };
}

const PROJ_GUOLU = projectFixture('proj-guolu-prov', '锅炉厂', ['guolu']);
const PROJ_SHANGZHONG = projectFixture('proj-shangzhong-prov', '上重', ['shangzhong']);
const TENANT_PROJECTS = [PROJ_GUOLU, PROJ_SHANGZHONG];

/**
 * Mirrors the requestContext surface routes/chat.ts sets for a chat turn:
 * `projectPin` + `tenantProjects` (table_get's mismatch check + legacy shim)
 * and `scopedMcpToolsets` + `pinnedProjectScope` (the load tools' scope).
 */
function ctxFor(opts: {
  pin?: string | null;
  projects?: Project[];
  toolsets?: Record<string, unknown>;
  entryPin?: string | null;
}): ToolCtx {
  const values: Record<string, unknown> = {
    projectPin: opts.pin ?? null,
    tenantProjects: opts.projects ?? [],
    scopedMcpToolsets: opts.toolsets,
    pinnedProjectScope:
      opts.pin != null ? { id: opts.pin, entryPin: opts.entryPin ?? 'compass' } : null,
  };
  return { requestContext: { get: (key: string) => values[key] } };
}

type TableGetOut = {
  sheet: string;
  source?: { server: string; project?: string; tenant?: string; loadedAt: string };
  warning?: string;
  refused?: boolean;
  rows?: unknown[];
};

// table_get's mastra-inferred execute type is a union with `void` /
// ValidationError — narrow to the shape this suite actually asserts on.
async function callTableGet(
  tools: ReturnType<typeof buildTableTools>,
  input: { sheet: string },
  ctx?: ToolCtx,
): Promise<TableGetOut> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tools.table_get.execute as any)(input, ctx ?? {});
}

function scheduleToolset(tenant?: string) {
  return {
    get_schedule_rows: {
      execute: async () => ({
        columns: [{ key: 'order_id', name: 'order_id', type: 'text' }],
        rows: [{ order_id: 'O1' }],
        total: 1,
        ...(tenant !== undefined ? { tenant } : {}),
      }),
    },
  };
}

/** Load the schedule sheet as a pinned chat turn for `project` would. */
async function loadScheduleUnderProject(project: Project, tenant: string) {
  const tools = buildTableTools(
    () => ({}),
    () => ({ compass: 'compass-proj' }),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await (tools.load_compass_schedule.execute as any)(
    {},
    ctxFor({ pin: project.id, toolsets: { compass: scheduleToolset(tenant) } }),
  );
  assert.equal(out.ok, true);
  return tools;
}

describe('table provenance: stamping on Compass (re)load', () => {
  it('stamps server + project + tenant + loadedAt: project = the PINNED PROJECT id, server = the toolset key (display)', async () => {
    const before = Date.now();
    const tools = await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');
    void tools;

    const meta = getTableSheetMeta(scheduleIdOf(PROJ_GUOLU));
    assert.ok(meta?.source, 'expected sheet meta to carry a source stamp');
    assert.equal(conn(meta!.source).server, 'compass');
    assert.equal(conn(meta!.source).project, PROJ_GUOLU.id);
    assert.equal(conn(meta!.source).tenant, 'guolu');
    assert.ok(
      Date.parse(conn(meta!.source).loadedAt ?? '') >= before,
      `loadedAt ${conn(meta!.source).loadedAt} should be >= test start`,
    );
  });

  it('无项目根本装不进来 —— 旧的"没项目也能装、只盖一个 server 戳"那条路已经关了', async () => {
    // 那条路正是项目数据落进个人区的入口(spec §0 ②)。现在装载前就拒。
    const getToolsets = () => ({ 'compass-shangzhong': scheduleToolset('shangzhong') });
    const tools = buildTableTools(getToolsets);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (tools.load_compass_schedule.execute as any)({});

    assert.equal(out.ok, false);
    assert.match(String(out.error), /没有选项目/);
  });

  it('omits tenant when the Compass payload carries none', async () => {
    const tools = buildTableTools(() => ({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.load_compass_schedule.execute as any)(
      {},
      ctxFor({ pin: PROJ_GUOLU.id, toolsets: { compass: scheduleToolset(undefined) } }),
    );

    const meta = getTableSheetMeta(scheduleIdOf(PROJ_GUOLU));
    assert.ok(meta?.source);
    assert.equal(conn(meta!.source).tenant, undefined);
  });

  it('re-stamps loadedAt on a repeat load', async () => {
    await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');
    const first = conn(getTableSheetMeta(scheduleIdOf(PROJ_GUOLU))!.source).loadedAt;

    await new Promise((r) => setTimeout(r, 5));
    await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');
    const second = conn(getTableSheetMeta(scheduleIdOf(PROJ_GUOLU))!.source).loadedAt;

    assert.notEqual(first, second);
  });
});

/**
 * 归属上线之后(spec §4):跨项目**根本看不见**,不是"看得见但被拒"。拒绝那道
 * 守卫仍在,降级为纵深防御 —— 只在结构够不着的地方(作用域内却带着别的项目的
 * 戳)才会触发。两种写法都留着测:结构一条,守卫一条。
 */
describe('table_get: 跨项目在结构上就够不着', () => {
  it('别的项目装的表,在本项目里查不到 —— 拿不到它的行', async () => {
    const tools = await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');

    const out = await callTableGet(
      tools,
      { sheet: 'schedule' },
      ctxFor({ pin: PROJ_SHANGZHONG.id, projects: TENANT_PROJECTS }),
    );
    // 解析落到了上重自己的作用域(那里还没有 schedule),不是锅炉厂那张
    assert.notEqual(out.sheet, scheduleIdOf(PROJ_GUOLU));
    assert.equal(out.rows?.length ?? 0, 0);
    assert.equal('source' in out, false, '拿不到别的项目的来源戳');
  });

  it('反方向同理', async () => {
    const tools = await loadScheduleUnderProject(PROJ_SHANGZHONG, 'shangzhong');

    const out = await callTableGet(
      tools,
      { sheet: 'schedule' },
      ctxFor({ pin: PROJ_GUOLU.id, projects: TENANT_PROJECTS }),
    );
    assert.notEqual(out.sheet, scheduleIdOf(PROJ_SHANGZHONG));
    assert.notEqual(conn(out.source).project, PROJ_SHANGZHONG.id, '拿到的绝不是上重那张');
  });

  it('守卫仍在:作用域内的表带着别的项目的戳(陈旧状态),照样拒行', async () => {
    // 结构够不着的地方还有一道 —— 比如迁移遗留、或手工改过的戳。
    const created = createTableSheet(`stale-stamp-${Date.now()}`, projectScope(PROJ_SHANGZHONG.id));
    assert.ok(created);
    await stampTableSheetSource(created!.id, {
      server: 'compass', project: PROJ_GUOLU.id, tenant: 'guolu',
      loadedAt: '2026-07-20T00:00:00.000Z',
    }).catch(() => undefined);
    const tools = buildTableTools();

    const out = await callTableGet(
      tools,
      { sheet: created!.id },
      ctxFor({ pin: PROJ_SHANGZHONG.id, projects: TENANT_PROJECTS }),
    );
    assert.equal(out.refused, true);
    assert.equal('rows' in out, false, 'refused response must carry no row data');
    assert.match(out.warning ?? '', /^注意:/);
    assert.match(out.warning ?? '', new RegExp(PROJ_GUOLU.id));
    assert.match(out.warning ?? '', /勿与当前项目的实时数据混用/);
  });

  it('no warning when the sheet source.project matches the current project pin', async () => {
    const tools = await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');

    const out = await callTableGet(
      tools,
      { sheet: 'schedule' }, // 短名在本项目里解析到本项目那张
      ctxFor({ pin: PROJ_GUOLU.id, projects: TENANT_PROJECTS }),
    );
    assert.equal('warning' in out, false);
    assert.equal(conn(out.source).project, PROJ_GUOLU.id);
  });

  it('legacy unstamped sheet under a pin gets the legacy warning, not the mismatch warning — and still returns rows (audit fix #2 refuses only STAMPED mismatches, not unlabeled legacy data)', async () => {
    const created = createTableSheet('legacy-sheet-pin', PERSONAL_SCOPE);
    assert.ok(created);
    const tools = buildTableTools();

    const out = await callTableGet(
      tools,
      { sheet: created!.id },
      ctxFor({ pin: PROJ_GUOLU.id, projects: TENANT_PROJECTS }),
    );
    assert.equal('source' in out, false);
    assert.equal(out.warning, '本表无来源记录(旧数据), 无法确认属于当前项目');
    assert.equal(out.refused ?? false, false, 'legacy unstamped sheets must not be refused');
    assert.ok(Array.isArray(out.rows), 'legacy unstamped sheets must still return rows');
  });

  it('legacy unstamped sheet with no pin is byte-identical to pre-provenance output (no source, no warning)', async () => {
    const created = createTableSheet('legacy-sheet-nopin', PERSONAL_SCOPE);
    assert.ok(created);
    const tools = buildTableTools();

    const out = await callTableGet(tools, { sheet: created!.id });
    assert.equal('source' in out, false);
    assert.equal('warning' in out, false);
  });
});

/**
 * G1 (2026-08-12 端到端验证): 工具是 fail-closed 的,自信是 fail-open 的。
 *
 * 未钉项目的「个人」会话拿不到任何 compass MCP 工具(`resolveChatMcpScope` 的
 * fail-closed 设计),但 agent 不会因此说"我没有数据"——它转头读工作区里**上次
 * 在某个项目下加载的排产表**,把陈旧的工厂数据当依据编出整套分析,用户无从知道
 * 这个回答与 Compass 无关。系统提示块里那句"当前会话在「个人」区"早就在了
 * (chat.ts buildProjectPinBlock),实测证明**散文拦不住**(见
 * grounding-eval 两臂实测:提示块在可测维度上零效果)。
 *
 * 所以这里走结构:**带 compass 来源戳的表 = 项目数据**,会话不在任何项目里就
 * 不供给它——与 widget/MCP 通道早已生效的"个人会话一律拒绝"对齐
 * (`resolveScopedServerNames`)。没戳的表(用户自己传的 CSV/Excel)是个人数据,
 * 行为逐字不变。
 */
describe('G1: 未钉项目的会话不得读取项目数据(带来源戳的表)', () => {
  it('个人区看不到项目装进来的表 —— 结构上就不在(不再是"看得见但被拒")', async () => {
    const tools = await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');

    const out = await callTableGet(tools, { sheet: 'schedule' }, ctxFor({ pin: null }));

    assert.notEqual(out.sheet, scheduleIdOf(PROJ_GUOLU), '解析不到项目那张');
    assert.equal('source' in out, false, '拿不到项目的来源戳');
    // 个人区的表照常可读(这里是空的默认表),项目数据一行也带不出来
    assert.equal((out.rows ?? []).length, 0);
  });

  it('拿着项目那张表的裸 id 在个人区查,同样够不着', async () => {
    // 结构防线不能只拦短名 —— agent 见过内部 id 就会照抄。
    const tools = await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');

    const out = await callTableGet(tools, { sheet: scheduleIdOf(PROJ_GUOLU) }, ctxFor({ pin: null }));

    assert.notEqual(out.sheet, scheduleIdOf(PROJ_GUOLU));
    assert.equal('source' in out, false);
  });

  it('没有 requestContext(不在对话里调用)= 个人区,同样够不着', async () => {
    const tools = await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');

    const out = await callTableGet(tools, { sheet: 'schedule' });

    assert.notEqual(out.sheet, scheduleIdOf(PROJ_GUOLU));
    assert.equal('source' in out, false);
  });

  it('refuses a LEGACY entry-name stamp too (project data is project data, mapped or not)', async () => {
    const created = createTableSheet(`g1-legacy-${Date.now()}`, PERSONAL_SCOPE);
    assert.ok(created);
    await stampTableSheetSource(created!.id, {
      server: 'compass-guolu',
      tenant: 'guolu',
      loadedAt: '2026-07-20T00:00:00.000Z',
    }).catch(() => undefined);
    const tools = buildTableTools();

    const out = await callTableGet(tools, { sheet: created!.id }, ctxFor({ pin: null }));

    assert.equal(out.refused, true);
    assert.equal('rows' in out, false);
    assert.match(out.warning ?? '', /compass-guolu/);
  });

  it('UNSTAMPED sheets (the user\'s own upload) stay fully readable in the personal area — byte-identical to before', async () => {
    const created = createTableSheet(`g1-personal-${Date.now()}`, PERSONAL_SCOPE);
    assert.ok(created);
    const tools = buildTableTools();

    const out = await callTableGet(tools, { sheet: created!.id }, ctxFor({ pin: null }));

    assert.equal(out.refused ?? false, false, '个人数据不受影响');
    assert.ok(Array.isArray(out.rows));
    assert.equal('warning' in out, false);
    assert.equal('source' in out, false);
  });

  it('个人区的系统提示块里没有项目那张表 —— 连名字带样本行都不进去', async () => {
    await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');

    const block = buildTableContextBlock(PERSONAL_SCOPE, null, TENANT_PROJECTS);

    assert.doesNotMatch(block, new RegExp(scheduleIdOf(PROJ_GUOLU)));
    assert.doesNotMatch(block, /O1/, '未钉项目时不得把项目数据样本喂进提示词');
  });

  it('formatTableContextBlock renders the unscoped-project-data note with no columns or rows', () => {
    const block = formatTableContextBlock([
      {
        id: 'sheet-unscoped',
        name: 'Unscoped Sheet',
        columns: [{ key: 'secret', name: 'Secret' }],
        rowCount: 5,
        sampleRows: [{ row_id: 'r1', secret: 'do-not-leak' }],
        unscopedProjectData: true,
      },
    ]);

    assert.match(block, /跳过: 本表是项目数据/);
    assert.match(block, /移动|新建/);
    assert.doesNotMatch(block, /do-not-leak/);
    assert.doesNotMatch(block, /Secret/);
  });
});

describe('isUnscopedProjectData (G1 predicate)', () => {
  it('true only for a stamped source with no project pin', () => {
    const stamped = { server: 'compass', project: PROJ_GUOLU.id, loadedAt: 'x' };
    assert.equal(isUnscopedProjectData(stamped, null), true);
    assert.equal(isUnscopedProjectData(stamped, undefined), true);
    assert.equal(isUnscopedProjectData({ server: 'compass-guolu', loadedAt: 'x' }, null), true);
    assert.equal(isUnscopedProjectData(stamped, PROJ_GUOLU.id), false, '有钉定 → 交给 mismatch 判据');
    assert.equal(isUnscopedProjectData(undefined, null), false, '无戳 = 个人数据');
    assert.equal(isUnscopedProjectData(null, null), false);
  });
});

describe('table_get: LEGACY entry-name stamps via the legacyServerToProjectId shim', () => {
  let sheetSeq = 0;

  /**
   * 一张**落在给定作用域里**、却带着迁移前老戳(只有 server、没有 project)的表。
   * 归属上线后,老戳判定只在这种"作用域够得着"的表上还会被走到(spec §4)。
   */
  async function legacyStampedSheet(
    server: string,
    tenant?: string,
    scope = projectScope(PROJ_GUOLU.id),
  ): Promise<string> {
    const created = createTableSheet(`legacy-stamp-${server}-${++sheetSeq}-${Date.now()}`, scope);
    assert.ok(created);
    // In-memory stamp is synchronous inside stampTableSheetSource; the awaited
    // DB persist is best-effort in this no-DB suite (same tolerance as
    // stampCompassLoadSource's fire-and-forget persist).
    await stampTableSheetSource(created!.id, {
      server,
      ...(tenant ? { tenant } : {}),
      loadedAt: '2026-07-20T00:00:00.000Z',
    }).catch(() => undefined);
    assert.equal(conn(getTableSheetMeta(created!.id)?.source).server, server);
    return created!.id;
  }

  it("a 'compass-guolu' stamp MATCHES the guolu default project pin via the shim (rows returned, no warning)", async () => {
    const sheetId = await legacyStampedSheet('compass-guolu', 'guolu');
    const tools = buildTableTools();

    const out = await callTableGet(
      tools,
      { sheet: sheetId },
      ctxFor({ pin: PROJ_GUOLU.id, projects: TENANT_PROJECTS }),
    );
    assert.equal(out.refused ?? false, false, 'shim must map the legacy stamp to its project');
    assert.ok(Array.isArray(out.rows));
    assert.equal('warning' in out, false);
  });

  it("the same 'compass-guolu' stamp REFUSES under the shangzhong project pin", async () => {
    // 表在上重的作用域里(够得着),但戳是锅炉厂的老名字 —— 守卫该拒。
    const sheetId = await legacyStampedSheet('compass-guolu', 'guolu',
                                             projectScope(PROJ_SHANGZHONG.id));
    const tools = buildTableTools();

    const out = await callTableGet(
      tools,
      { sheet: sheetId },
      ctxFor({ pin: PROJ_SHANGZHONG.id, projects: TENANT_PROJECTS }),
    );
    assert.equal(out.refused, true);
    assert.equal('rows' in out, false);
    assert.match(out.warning ?? '', /compass-guolu/);
  });

  it('an UNMAPPABLE stamped source refuses under any pin (foreign server / unknown scene / no project rows)', async () => {
    const tools = buildTableTools();

    // Foreign MCP server stamp.
    const foreign = await legacyStampedSheet('some-other-mcp');
    const outForeign = await callTableGet(
      tools,
      { sheet: foreign },
      ctxFor({ pin: PROJ_GUOLU.id, projects: TENANT_PROJECTS }),
    );
    assert.equal(outForeign.refused, true);

    // Compass-prefixed but unknown scene: maps to no default project.
    const unknownScene = await legacyStampedSheet('compass-nowhere');
    const outUnknown = await callTableGet(
      tools,
      { sheet: unknownScene },
      ctxFor({ pin: PROJ_GUOLU.id, projects: TENANT_PROJECTS }),
    );
    assert.equal(outUnknown.refused, true);

    // Mappable name but NO project rows available (shim starved): fail-closed.
    const mappable = await legacyStampedSheet('compass-guolu');
    const outNoRows = await callTableGet(
      tools,
      { sheet: mappable },
      ctxFor({ pin: PROJ_GUOLU.id, projects: [] }),
    );
    assert.equal(outNoRows.refused, true, 'no project rows → unmappable → hard refuse');
  });
});

describe('risk #1 regression: provenance never collapses to the shared toolset key', () => {
  it("sheets loaded by two different projects — both resolving toolset key 'compass' — stamp DISTINCT project ids and refuse across pins", async () => {
    // Both requests resolve the SAME toolset key ('compass'): the collapse
    // scenario. If the stamp were the resolved key, both stamps would be
    // 'compass', every mismatch check would pass, and cross-project sheet
    // mixing would go silently undetected (regression of audit fix #2).
    const tools = await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');
    const guoluStamp = getTableSheetMeta(scheduleIdOf(PROJ_GUOLU))!.source!;
    assert.equal(guoluStamp.project, PROJ_GUOLU.id);
    assert.notEqual(guoluStamp.project, 'compass', 'stamp must NEVER be the toolset key');

    // 上重的会话读不到锅炉厂那张(归属之后是**够不着**,不是"够得着但被拒")
    const fromShangzhong = await callTableGet(
      tools,
      { sheet: 'schedule' },
      ctxFor({ pin: PROJ_SHANGZHONG.id, projects: TENANT_PROJECTS }),
    );
    assert.notEqual(conn(fromShangzhong.source).project, PROJ_GUOLU.id);

    // 上重自己装一份:两张表并存,戳各是各的(不会因为共用 'compass' 这个 key 而塌成一个)
    await loadScheduleUnderProject(PROJ_SHANGZHONG, 'shangzhong');
    const szStamp = getTableSheetMeta(scheduleIdOf(PROJ_SHANGZHONG))!.source!;
    assert.equal(szStamp.project, PROJ_SHANGZHONG.id);
    assert.notEqual(
      szStamp.project,
      guoluStamp.project,
      'two projects sharing the compass key must still produce DISTINCT stamps',
    );

    // 各自的会话各读各的那张,都不被拒
    const inGuolu = await callTableGet(
      tools,
      { sheet: 'schedule' },
      ctxFor({ pin: PROJ_GUOLU.id, projects: TENANT_PROJECTS }),
    );
    assert.equal(inGuolu.refused ?? false, false);
    assert.equal(conn(inGuolu.source).project, PROJ_GUOLU.id);

    const inShangzhong = await callTableGet(
      tools,
      { sheet: 'schedule' },
      ctxFor({ pin: PROJ_SHANGZHONG.id, projects: TENANT_PROJECTS }),
    );
    assert.equal(inShangzhong.refused ?? false, false);
    assert.equal(conn(inShangzhong.source).project, PROJ_SHANGZHONG.id);
  });
});

describe('isProjectPinMismatch (project-id keyed, with the legacy shim)', () => {
  it('false with no pin, no source, or a matching source.project', () => {
    assert.equal(isProjectPinMismatch(undefined, null), false);
    assert.equal(
      isProjectPinMismatch(undefined, PROJ_GUOLU.id, TENANT_PROJECTS),
      false,
      'legacy unstamped → not a hard mismatch',
    );
    assert.equal(
      isProjectPinMismatch(
        { server: 'compass', project: PROJ_GUOLU.id, loadedAt: 'x' },
        PROJ_GUOLU.id,
        TENANT_PROJECTS,
      ),
      false,
    );
  });

  it('true for a STAMPED, differing source.project — even though both stamps share server "compass"', () => {
    assert.equal(
      isProjectPinMismatch(
        { server: 'compass', project: PROJ_GUOLU.id, loadedAt: 'x' },
        PROJ_SHANGZHONG.id,
        TENANT_PROJECTS,
      ),
      true,
    );
  });

  it('legacy stamps go through the shim: match ⇔ the mapped default project equals the pin', () => {
    assert.equal(
      isProjectPinMismatch(
        { server: 'compass-guolu', loadedAt: 'x' },
        PROJ_GUOLU.id,
        TENANT_PROJECTS,
      ),
      false,
    );
    assert.equal(
      isProjectPinMismatch(
        { server: 'compass-guolu', loadedAt: 'x' },
        PROJ_SHANGZHONG.id,
        TENANT_PROJECTS,
      ),
      true,
    );
  });

  it('an unmappable stamped source is a mismatch (fail-closed), including when no project rows are supplied', () => {
    assert.equal(
      isProjectPinMismatch({ server: 'some-other-mcp', loadedAt: 'x' }, PROJ_GUOLU.id, TENANT_PROJECTS),
      true,
    );
    assert.equal(
      isProjectPinMismatch({ server: 'compass-guolu', loadedAt: 'x' }, PROJ_GUOLU.id),
      true,
      'shim starved of project rows → unmappable → mismatch',
    );
  });
});

describe('buildTableContextBlock: pinned mismatch is omitted from the injected prompt block', () => {
  it('formatTableContextBlock replaces a pinMismatch sheet with a one-line note, no row data', () => {
    const block = formatTableContextBlock([
      {
        id: 'sheet-mismatch',
        name: 'Mismatched Sheet',
        columns: [{ key: 'secret', name: 'Secret' }],
        rowCount: 5,
        sampleRows: [{ row_id: 'r1', secret: 'do-not-leak' }],
        pinMismatch: true,
      },
    ]);
    assert.match(block, /跳过: 数据来源与当前项目不一致/);
    assert.match(block, /请在当前项目下重新加载/);
    assert.doesNotMatch(block, /do-not-leak/);
    assert.doesNotMatch(block, /Secret/);
  });

  it('a non-mismatched sheet in the same block renders normally', () => {
    const block = formatTableContextBlock([
      {
        id: 'sheet-ok',
        name: 'OK Sheet',
        columns: [{ key: 'val', name: 'Value' }],
        rowCount: 1,
        sampleRows: [{ row_id: 'r1', val: 'visible-data' }],
      },
    ]);
    assert.match(block, /visible-data/);
  });

  it('buildTableContextBlock end-to-end: a project-stamped mismatched sheet is omitted, a matching one is not', async () => {
    await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');

    const meta = getTableSheetMeta(scheduleIdOf(PROJ_GUOLU));
    assert.equal(conn(meta?.source).project, PROJ_GUOLU.id);

    // The whole-block assertions target the schedule sheet's own section:
    // this suite's earlier tests legitimately leave OTHER (foreign-stamped)
    // sheets in the shared in-memory store, which correctly show 跳过 under
    // any pin — that is the fail-closed behavior, not noise.
    const guoluSheetId = scheduleIdOf(PROJ_GUOLU);
    const scheduleLine = (block: string): string =>
      block.split('\n').find((line) => line.includes(`(id: \`${guoluSheetId}\`)`)) ?? '';

    // 上重的会话:锅炉厂那张**根本不在列表里**。
    // (行内容不能用来判别 —— 本套用例里两个项目喂的是同一份假数据,上重自己那张
    //  也有 O1;能判别的是 sheet id。)
    const otherProjectBlock = buildTableContextBlock(
      projectScope(PROJ_SHANGZHONG.id), PROJ_SHANGZHONG.id, TENANT_PROJECTS);
    assert.equal(scheduleLine(otherProjectBlock), '');
    assert.doesNotMatch(otherProjectBlock, new RegExp(guoluSheetId));

    // 锅炉厂自己的会话:在,而且有数据
    const matchingBlock = buildTableContextBlock(
      projectScope(PROJ_GUOLU.id), PROJ_GUOLU.id, TENANT_PROJECTS);
    assert.doesNotMatch(scheduleLine(matchingBlock), /跳过:/);
    assert.match(matchingBlock, /O1/);
  });
});
