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

    const meta = getTableSheetMeta('schedule');
    assert.ok(meta?.source, 'expected sheet meta to carry a source stamp');
    assert.equal(meta!.source!.server, 'compass');
    assert.equal(meta!.source!.project, PROJ_GUOLU.id);
    assert.equal(meta!.source!.tenant, 'guolu');
    assert.ok(
      Date.parse(meta!.source!.loadedAt) >= before,
      `loadedAt ${meta!.source!.loadedAt} should be >= test start`,
    );
  });

  it('legacy ungrouped deployment (no request scope): stamps the resolved server name only, no project', async () => {
    const getToolsets = () => ({ 'compass-shangzhong': scheduleToolset('shangzhong') });
    const tools = buildTableTools(getToolsets);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.load_compass_schedule.execute as any)({});

    const meta = getTableSheetMeta('schedule');
    assert.equal(meta?.source?.server, 'compass-shangzhong');
    assert.equal(meta?.source?.project, undefined);
    assert.equal(meta?.source?.tenant, 'shangzhong');
  });

  it('omits tenant when the Compass payload carries none', async () => {
    const getToolsets = () => ({ compass: scheduleToolset(undefined) });
    const tools = buildTableTools(getToolsets);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tools.load_compass_schedule.execute as any)({});

    const meta = getTableSheetMeta('schedule');
    assert.ok(meta?.source);
    assert.equal(meta!.source!.tenant, undefined);
  });

  it('re-stamps loadedAt on a repeat load', async () => {
    await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');
    const first = getTableSheetMeta('schedule')!.source!.loadedAt;

    await new Promise((r) => setTimeout(r, 5));
    await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');
    const second = getTableSheetMeta('schedule')!.source!.loadedAt;

    assert.notEqual(first, second);
  });
});

describe('table_get: source + project-pin mismatch refusal (project-id keyed)', () => {
  it('refuses the rows (no row data) when the sheet source.project differs from the current project pin', async () => {
    const tools = await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');

    const out = await callTableGet(
      tools,
      { sheet: 'schedule' },
      ctxFor({ pin: PROJ_SHANGZHONG.id, projects: TENANT_PROJECTS }),
    );
    assert.equal(out.refused, true);
    assert.equal('rows' in out, false, 'refused response must carry no row data');
    assert.equal('source' in out, false, 'refused response must carry no source either');
    assert.match(out.warning ?? '', /^注意:/);
    assert.match(out.warning ?? '', new RegExp(PROJ_GUOLU.id));
    assert.match(out.warning ?? '', /guolu/); // tenant
    assert.match(out.warning ?? '', new RegExp(PROJ_SHANGZHONG.id));
    assert.match(out.warning ?? '', /勿与当前项目的实时数据混用/);
    assert.match(out.warning ?? '', /请在当前项目下重新加载/);
  });

  it('refuses in the OTHER direction too: a shangzhong-project sheet under the guolu-project pin', async () => {
    const tools = await loadScheduleUnderProject(PROJ_SHANGZHONG, 'shangzhong');

    const out = await callTableGet(
      tools,
      { sheet: 'schedule' },
      ctxFor({ pin: PROJ_GUOLU.id, projects: TENANT_PROJECTS }),
    );
    assert.equal(out.refused, true);
    assert.equal('rows' in out, false);
  });

  it('no warning when the sheet source.project matches the current project pin', async () => {
    const tools = await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');

    const out = await callTableGet(
      tools,
      { sheet: 'schedule' },
      ctxFor({ pin: PROJ_GUOLU.id, projects: TENANT_PROJECTS }),
    );
    assert.equal('warning' in out, false);
    assert.equal(out.source!.project, PROJ_GUOLU.id);
  });

  it('legacy unstamped sheet under a pin gets the legacy warning, not the mismatch warning — and still returns rows (audit fix #2 refuses only STAMPED mismatches, not unlabeled legacy data)', async () => {
    const created = createTableSheet('legacy-sheet-pin');
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
    const created = createTableSheet('legacy-sheet-nopin');
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
  it('refuses a project-stamped sheet when the turn has no project pin', async () => {
    const tools = await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');

    const out = await callTableGet(tools, { sheet: 'schedule' }, ctxFor({ pin: null }));

    assert.equal(out.refused, true, '个人会话读项目数据必须被拒绝,而不是拿到行');
    assert.equal('rows' in out, false, 'refused response must carry no row data');
    assert.equal('source' in out, false);
    assert.match(out.warning ?? '', /项目数据/);
    assert.match(out.warning ?? '', new RegExp(PROJ_GUOLU.id));
    assert.match(out.warning ?? '', /不能作为依据/);
    assert.match(out.warning ?? '', /移动|新建/);
  });

  it('refuses with no requestContext at all (tool invoked outside a chat turn — same ambiguity, same fail-closed)', async () => {
    const tools = await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');

    const out = await callTableGet(tools, { sheet: 'schedule' });

    assert.equal(out.refused, true);
    assert.equal('rows' in out, false);
  });

  it('refuses a LEGACY entry-name stamp too (project data is project data, mapped or not)', async () => {
    const created = createTableSheet(`g1-legacy-${Date.now()}`);
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
    const created = createTableSheet(`g1-personal-${Date.now()}`);
    assert.ok(created);
    const tools = buildTableTools();

    const out = await callTableGet(tools, { sheet: created!.id }, ctxFor({ pin: null }));

    assert.equal(out.refused ?? false, false, '个人数据不受影响');
    assert.ok(Array.isArray(out.rows));
    assert.equal('warning' in out, false);
    assert.equal('source' in out, false);
  });

  it('buildTableContextBlock withholds a project-stamped sheet from the unpinned system prompt (no sample rows)', async () => {
    await loadScheduleUnderProject(PROJ_GUOLU, 'guolu');

    const block = buildTableContextBlock(null, null, TENANT_PROJECTS);

    const scheduleLine = block.split('\n').find((l) => l.includes('(id: `schedule`)')) ?? '';
    assert.match(scheduleLine, /跳过: 本表是项目数据/);
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

  /** Create a sheet carrying a pre-migration stamp (server only, no project). */
  async function legacyStampedSheet(server: string, tenant?: string): Promise<string> {
    const created = createTableSheet(`legacy-stamp-${server}-${++sheetSeq}-${Date.now()}`);
    assert.ok(created);
    // In-memory stamp is synchronous inside stampTableSheetSource; the awaited
    // DB persist is best-effort in this no-DB suite (same tolerance as
    // stampCompassLoadSource's fire-and-forget persist).
    await stampTableSheetSource(created!.id, {
      server,
      ...(tenant ? { tenant } : {}),
      loadedAt: '2026-07-20T00:00:00.000Z',
    }).catch(() => undefined);
    assert.equal(getTableSheetMeta(created!.id)?.source?.server, server);
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
    const sheetId = await legacyStampedSheet('compass-guolu', 'guolu');
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
    const guoluStamp = getTableSheetMeta('schedule')!.source!;
    assert.equal(guoluStamp.project, PROJ_GUOLU.id);
    assert.notEqual(guoluStamp.project, 'compass', 'stamp must NEVER be the toolset key');

    // The guolu-loaded sheet is refused under the shangzhong pin...
    const refusedUnderShangzhong = await callTableGet(
      tools,
      { sheet: 'schedule' },
      ctxFor({ pin: PROJ_SHANGZHONG.id, projects: TENANT_PROJECTS }),
    );
    assert.equal(refusedUnderShangzhong.refused, true);

    // ...then reloaded under shangzhong it re-keys, and the direction flips.
    await loadScheduleUnderProject(PROJ_SHANGZHONG, 'shangzhong');
    const szStamp = getTableSheetMeta('schedule')!.source!;
    assert.equal(szStamp.project, PROJ_SHANGZHONG.id);
    assert.notEqual(
      szStamp.project,
      guoluStamp.project,
      'two projects sharing the compass key must still produce DISTINCT stamps',
    );

    const refusedUnderGuolu = await callTableGet(
      tools,
      { sheet: 'schedule' },
      ctxFor({ pin: PROJ_GUOLU.id, projects: TENANT_PROJECTS }),
    );
    assert.equal(refusedUnderGuolu.refused, true);

    const okUnderShangzhong = await callTableGet(
      tools,
      { sheet: 'schedule' },
      ctxFor({ pin: PROJ_SHANGZHONG.id, projects: TENANT_PROJECTS }),
    );
    assert.equal(okUnderShangzhong.refused ?? false, false);
    assert.ok(Array.isArray(okUnderShangzhong.rows));
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

    const meta = getTableSheetMeta('schedule');
    assert.equal(meta?.source?.project, PROJ_GUOLU.id);

    // The whole-block assertions target the schedule sheet's own section:
    // this suite's earlier tests legitimately leave OTHER (foreign-stamped)
    // sheets in the shared in-memory store, which correctly show 跳过 under
    // any pin — that is the fail-closed behavior, not noise.
    const scheduleLine = (block: string): string =>
      block.split('\n').find((line) => line.includes('(id: `schedule`)')) ?? '';

    const mismatchedBlock = buildTableContextBlock(null, PROJ_SHANGZHONG.id, TENANT_PROJECTS);
    assert.match(scheduleLine(mismatchedBlock), /跳过: 数据来源与当前项目不一致/);
    assert.doesNotMatch(mismatchedBlock, /O1/); // the seeded row's order_id

    const matchingBlock = buildTableContextBlock(null, PROJ_GUOLU.id, TENANT_PROJECTS);
    assert.doesNotMatch(scheduleLine(matchingBlock), /跳过:/);
    assert.match(matchingBlock, /O1/);
  });
});
