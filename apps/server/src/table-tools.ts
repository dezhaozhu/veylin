import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { TableSheetSource } from '@veylin/db';
import type { Project } from '@veylin/shared';
import {
  addTableColumn,
  addTableRow,
  createTableSheet,
  DEFAULT_TABLE_GET_LIMIT,
  deleteTableColumn,
  deleteTableRows,
  deleteTableSheet,
  emitTableChart,
  getTableSheetMeta,
  importTableSheet,
  isProjectPinMismatch,
  isUnscopedProjectData,
  listTableColumns,
  listTableRows,
  listTableRowsPage,
  listTableSheets,
  flushTablePersist,
  tableRowKey,
  MAX_TABLE_GET_LIMIT,
  renameTableSheet,
  resolveTableSheetId,
  stampTableSheetSource,
  updateTableRow,
} from './table-store';

const rowSchema = z.record(z.string(), z.union([z.string(), z.number()]));
const cellValueSchema = z.union([z.string(), z.number()]);

import { unwrapMcpPayload } from './mcp-payload.js';
import { resolveCompassServer } from './mcp-scoping.js';
import { getSelection } from './table-selection.js';
import { PERSONAL_SCOPE, projectScope, sheetIdFor, type SheetScope } from './table-scope.js';
import { fetchCompassData, type CompassRestScope } from './compass-rest.js';

export { unwrapMcpPayload } from './mcp-payload.js';

export type ToolsetsGetter = () => Record<string, unknown>;

/** Server-name → project-group map, e.g. `{ compass: undefined, 'compass-guolu': 'compass' }'. */
export type McpServerGroups = Record<string, string | undefined>;
export type GroupsGetter = () => McpServerGroups;

/**
 * Per-call Compass resolution + provenance scope (project-cognition v3,
 * Phase B 5c).
 *
 * - `toolsets` — when present, the AUTHORITATIVE per-request toolset record:
 *   the chat turn's `requestContext.get('scopedMcpToolsets')` (project-scoped
 *   + mcpEnabled-filtered + pooled compass overlay, set by routes/chat.ts) or
 *   the HTTP routes' pooled record (routes/tables.ts's
 *   `resolveCompassRequestScope`). Resolution never falls back to the tenant
 *   getter past it — the record already encodes every per-request decision
 *   (deny, explicit-off, pool failure), and post-Task-4 the tenant cache
 *   cannot contain compass anyway (plan risk #2: a miss means "no compass",
 *   never a differently-scoped substitute). `undefined` (callers with no
 *   request scope at all — tests, legacy ungrouped deployments) falls back to
 *   the tenant getter, today's pre-v3 behavior.
 * - `entryPin` — the entry-level pin from the shared prelude
 *   (`scope.entryPin`, i.e. `'compass'`), fed to `resolveCompassServer`.
 * - `projectId` — the pinned PROJECT id, stamped as `source.project` on
 *   loaded sheets. Plan risk #1 (highest of the phase): this is NEVER the
 *   resolved toolset key — every project resolves the same `'compass'` key,
 *   so stamping the key would make all projects' stamps identical and blind
 *   `isProjectPinMismatch` completely.
 * - `rest` — the REST data-plane scope (spec 2026-08-06 三形态 §2 ①) for the
 *   same pin: `undefined` whenever `toolsets`/`entryPin`/`projectId` fall
 *   back (no pin, no entry) — there is no scene set to bind a REST call to.
 */
export type CompassLoadScope = {
  toolsets?: Record<string, unknown>;
  entryPin: string | null;
  projectId: string | null;
  rest?: CompassRestScope;
};

/**
 * Resolve the Compass toolset via `resolveCompassServer` (never a hardcoded
 * `toolsets['compass']`). Every call site below backs the workspace AG-Grid
 * panel (grid load buttons, load_compass_schedule/orders/resources agent
 * tools). The load_compass_* AGENT tools resolve their scope from the chat
 * request's `requestContext` (`compassScopeFromCtx`); the routes/tables.ts
 * HTTP routes resolve theirs from the request threadId via the shared prelude
 * + pool. `resolveCompassServer` still protects every caller: with no
 * matching pin and no unambiguous compass key it refuses (returns
 * `undefined`) rather than guessing and silently crossing a project boundary.
 */
interface ResolvedCompass {
  /** Connected toolset key (`'compass'` post-v3) — kept as the provenance
   * `source.server` for DISPLAY only; the durable identity is
   * `source.project`. */
  serverName: string;
  toolset: Record<string, { execute: (args: unknown) => Promise<unknown> }>;
}

function resolveCompassToolset(
  getMcpToolsets: ToolsetsGetter | undefined,
  getMcpGroups: GroupsGetter | undefined,
  scope?: CompassLoadScope,
): ResolvedCompass | undefined {
  // Request-scoped record (chat turn / pooled HTTP lookup) is authoritative
  // when present; the tenant getter is only the no-request-scope fallback.
  const toolsets = scope?.toolsets ?? getMcpToolsets?.() ?? {};
  const groups = getMcpGroups?.() ?? {};
  const serverName = resolveCompassServer(toolsets, groups, scope?.entryPin ?? null);
  if (!serverName) return undefined;
  const toolset = toolsets[serverName] as
    | Record<string, { execute: (args: unknown) => Promise<unknown> }>
    | undefined;
  if (!toolset) return undefined;
  return { serverName, toolset };
}

/** `payload.tenant` when Compass stamped one — the top-level tenant tag on
 * get_schedule_rows/get_resources responses. */
function tenantFromPayload(payload: Record<string, unknown>): string | undefined {
  const tenant = payload['tenant'];
  return typeof tenant === 'string' && tenant ? tenant : undefined;
}

/**
 * Stamps happen in-memory synchronously inside stampTableSheetSource (so an
 * immediate table_get in the same process sees it), then persist — but a persist
 * hiccup (no DB configured, transient failure) must not fail the load itself, the
 * same "fire-and-forget persist" tolerance every other table mutator gets.
 */
async function stampCompassLoadSource(
  sheetId: string,
  serverName: string,
  payload: Record<string, unknown>,
  projectId: string | null,
): Promise<void> {
  const source: TableSheetSource = {
    // Display only. The durable cross-project identity is `project` below —
    // NEVER this key (plan risk #1: post-v3 every project resolves the same
    // 'compass' toolset key, so keying provenance on it would collapse every
    // project's stamp into one value and blind isProjectPinMismatch). Also
    // the REST data-plane path's stand-in for a toolset key — the pin's
    // `entryPin` — since REST loads never resolve one.
    server: serverName,
    // The pinned PROJECT id at load time. Absent only for loads with no
    // project scope at all (legacy ungrouped deployments) — those stamps stay
    // server-only and hard-refuse under any project pin via the legacy shim.
    ...(projectId ? { project: projectId } : {}),
    tenant: tenantFromPayload(payload),
    loadedAt: new Date().toISOString(),
  };
  try {
    await stampTableSheetSource(sheetId, source);
  } catch (e) {
    console.error('[table-tools] provenance stamp persist failed:', e);
  }
}

/**
 * Layer-4 provenance check: a thread pinned to one project reading a sheet
 * stamped from a different server (or never stamped at all) is exactly the
 * silent cross-tenant mixing that motivated `source`.
 *
 * A STAMPED mismatch (source.project — or the shim-mapped legacy
 * source.server — names a different project) is now a hard
 * refusal in `table_get` — see `isProjectPinMismatch` — this text becomes the
 * refusal's `warning`. An UNSTAMPED ("legacy") sheet under a pin keeps the
 * softer text below as a plain warning (rows still returned): refusing every
 * pre-provenance sheet the moment a thread gets pinned would cut users off
 * from data they had every right to read, for no signal stronger than "we
 * don't know" — audit fix #2 deliberately draws the line at "we know it's
 * wrong" vs. "we don't know".
 */
function buildProvenanceWarning(
  source: TableSheetSource | null | undefined,
  projectPin: string | null | undefined,
  projects: Project[] = [],
): string | undefined {
  if (!projectPin) return undefined;
  if (!source) {
    return '本表无来源记录(旧数据), 无法确认属于当前项目';
  }
  // v3 re-key: match/mismatch is decided by the SAME predicate table_get and
  // buildTableContextBlock refuse on (source.project ?? legacy shim vs the
  // project-id pin) — never a raw string compare against the toolset key.
  if (!isProjectPinMismatch(source, projectPin, projects)) return undefined;
  return (
    `注意: 本表数据来自项目 ${source.project ?? source.server}(租户 ${source.tenant ?? '未知'}, ${source.loadedAt} 加载), ` +
    `与当前会话项目 ${projectPin} 不一致 — 勿与当前项目的实时数据混用`
  );
}

/**
 * G1 refusal text: says what the sheet IS (project data, whose, when loaded),
 * that it cannot ground this turn, and the one gesture that fixes it. No
 * hedging and no advice the model can read as optional — the rows are already
 * gone by the time it reads this.
 */
function buildUnscopedProjectDataWarning(source: TableSheetSource): string {
  return (
    `本表是项目数据(来自项目 ${source.project ?? source.server}, 租户 ${source.tenant ?? '未知'}, ` +
    `${source.loadedAt} 加载);当前会话未绑定任何项目,这些数据不能作为依据 — ` +
    `请将本会话移动到该项目,或在该项目下新建会话`
  );
}

interface TableToolCtx {
  requestContext?: { get(key: string): unknown };
}

/**
 * Read the chat turn's project pin (a PROJECT id post-v3) off the mastra tool
 * `execute` ctx — `requestContext.get('projectPin')`, set by routes/chat.ts.
 * Used by `table_get`'s provenance check.
 */
function readThreadId(ctx?: TableToolCtx): string | null {
  return (ctx?.requestContext?.get('threadId') as string | null | undefined) ?? null;
}


function readProjectPin(ctx?: TableToolCtx): string | null {
  return (ctx?.requestContext?.get('projectPin') as string | null | undefined) ?? null;
}

/**
 * Read the tenant's project rows off the ctx — `requestContext.get(
 * 'tenantProjects')`, set by routes/chat.ts for pinned turns. Feeds the
 * legacy-stamp shim in `isProjectPinMismatch`; absent (older callers, tests)
 * means legacy stamps are unmappable and hard-refuse under a pin (fail-closed).
 */
function readTenantProjects(ctx?: TableToolCtx): Project[] {
  const value = ctx?.requestContext?.get('tenantProjects');
  return Array.isArray(value) ? (value as Project[]) : [];
}

/**
 * 这一轮对话在哪个作用域(spec §3.3)。唯一入口 —— 三个调用面(agent 工具、
 * REST 路由、面板)都从这里推导,规则只有一处。
 */
export function resolveSheetScope(
  _threadId: string | null | undefined,
  projectPin: string | null | undefined,
): SheetScope {
  return projectPin ? projectScope(projectPin) : PERSONAL_SCOPE;
}

function scopeFromCtx(ctx?: TableToolCtx): SheetScope {
  return resolveSheetScope(readThreadId(ctx), readProjectPin(ctx));
}

/**
 * Compose the per-request Compass scope for the load_compass_* AGENT tools
 * from the chat turn's requestContext (all three set by routes/chat.ts):
 * `scopedMcpToolsets` (the final per-request toolsets, pooled compass
 * included) + `pinnedProjectScope` (`{id, entryPin, rest}` — the provenance
 * project id, the entry-level resolution pin, and the REST data-plane scope
 * for the same pin). No requestContext at all (a tool invoked outside a chat
 * turn) → `undefined`, i.e. tenant-getter fallback with a null pin — today's
 * no-thread-context refusal behavior under ambiguity.
 */
function compassScopeFromCtx(ctx?: TableToolCtx): CompassLoadScope | undefined {
  const rc = ctx?.requestContext;
  if (!rc) return undefined;
  const scoped = rc.get('scopedMcpToolsets');
  const pinScope = rc.get('pinnedProjectScope') as
    | { id: string; entryPin: string | null; rest?: CompassRestScope | null }
    | null
    | undefined;
  return {
    toolsets:
      scoped && typeof scoped === 'object' ? (scoped as Record<string, unknown>) : undefined,
    entryPin: pinScope?.entryPin ?? null,
    projectId: pinScope?.id ?? null,
    rest: pinScope?.rest ?? undefined,
  };
}

/**
 * Fetch schedule rows from the Compass `get_schedule_rows` MCP tool and import
 * them into the `schedule` sheet. Shared by the load_compass_schedule agent tool
 * and the /api/schedule-edit commit/discard routes (grid refresh after a draft
 * lands or is rolled back).
 */
export const SCHEDULE_SHEET_ID = 'schedule';

/**
 * 建表(只在第一次)并给页签一个人话名字。
 *
 * id 保持英文且稳定 —— 工具、REST、选区引用全按 id 走;显示名是给人看的,而三张
 * Compass 表本来就是同一个模型的三个**焦段**(订单 / 工序 / 派工),页签直接这么写,
 * 就不必再在工具栏上放一个说同一件事的切换器。
 */
function ensureCompassSheet(shortName: string, label: string, scope: SheetScope): string {
  const id = sheetIdFor(scope, shortName);
  if (listTableSheets(scope).find((s) => s.id === id)) return id;
  createTableSheet(shortName, scope);
  renameTableSheet(id, label);
  return id;
}


/**
 * Compass 装载的落点作用域:**必须有项目**。项目数据只能落在项目里 —— 个人区
 * 装不了(spec §3.4)。今天靠 `resolveCompassServer` 拿不到 entry 间接失败,
 * 报的是 "not connected",原因不对;这里显式拒绝并说人话。
 */
function compassSheetScope(scope?: CompassLoadScope): SheetScope | null {
  return scope?.projectId ? projectScope(scope.projectId) : null;
}

const NO_PROJECT_ERROR = '当前会话没有选项目,无法装载项目数据 —— 先选一个项目再试';

/**
 * Compass 的 typed columns → 网格的列描述:显示名 + 类型 + (status 列的)选项集与
 * 语义色。域知识全部来自服务端 —— Veylin 这边不重新硬编码一份状态色表。
 */
function compassColumnDescriptors(columns: Array<Record<string, unknown>>) {
  return columns
    .map((c) => {
      const key = String(c['key'] ?? '');
      if (!key) return null;
      const rawType = c['type'];
      const type: 'text' | 'number' | 'status' =
        rawType === 'number' ? 'number' : rawType === 'status' ? 'status' : 'text';
      const opts = c['options'];
      const sem = c['semantics'];
      return {
        key,
        name: String(c['name'] ?? key),
        type,
        statusOptions: type === 'status' && Array.isArray(opts) ? (opts as string[]) : undefined,
        semantics:
          type === 'status' && sem && typeof sem === 'object'
            ? (sem as Record<string, string>)
            : undefined,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
}

export async function importCompassScheduleSheet(
  getMcpToolsets: ToolsetsGetter | undefined,
  input: { limit?: number; workshop?: string; status?: string; order_id?: string },
  getMcpGroups?: GroupsGetter,
  scope?: CompassLoadScope,
  seams: { fetchImpl?: typeof fetch } = {},
): Promise<
  | { ok: true; sheet: string; imported: number; total: number; columns: number }
  | { ok: false; error: string }
> {
  const sheetScope = compassSheetScope(scope);
  if (!sheetScope) return { ok: false as const, error: NO_PROJECT_ERROR };
  // Load the FULL result set into the grid sheet (not just 500). This is safe for
  // the agent's context: importCompassScheduleSheet returns only a summary
  // (imported/total counts), never the rows — the rows go straight into the grid.
  // The grid paginates them client-side. An explicit input.limit still wins.
  let payload: Record<string, unknown> | undefined;
  let sourceName: string | undefined;
  if (scope?.rest) {
    // Data-plane first (spec 2026-08-06 ①): bulk rows come over plain REST —
    // no MCP framing, no double serialization, no tool-channel timeout class.
    const r = await fetchCompassData(
      scope.rest,
      '/data/schedule-rows',
      {
        limit: input.limit ?? 1_000_000,
        workshop: input.workshop,
        status: input.status,
        order_id: input.order_id,
      },
      seams,
    );
    if (r.ok) {
      payload = r.payload;
      sourceName = scope.entryPin ?? 'compass';
    } else {
      console.warn('[table-tools] compass data-plane fetch failed, falling back to MCP:', r.error);
    }
  }
  if (!payload) {
    // Resolve live toolsets via the getter (not a snapshot — rebuildMcp re-assigns the var)
    const compass = resolveCompassToolset(getMcpToolsets, getMcpGroups, scope);
    const tool = compass?.toolset['get_schedule_rows'];
    if (!compass || !tool) {
      return {
        ok: false as const,
        error: 'compass MCP server not connected (no get_schedule_rows)',
      };
    }
    const res: unknown = await tool.execute({
      limit: input.limit ?? 1_000_000,
      workshop: input.workshop,
      status: input.status,
      order_id: input.order_id,
    });
    payload = unwrapMcpPayload(res);
    sourceName = compass.serverName;
  }

  const columns = (payload['columns'] as Array<Record<string, unknown>> | undefined) ?? [];
  const rows = (payload['rows'] as Array<Record<string, unknown>> | undefined) ?? [];

  // Ensure the 'schedule' sheet exists (create on first use; fire-and-forget persist is fine)
  const sheetId = ensureCompassSheet(SCHEDULE_SHEET_ID, '工序', sheetScope);

  const descriptors = compassColumnDescriptors(columns);

  const result = importTableSheet(
    sheetId,
    [],
    rows as Array<Record<string, string | number>>,
    undefined,
    descriptors,
  );
  await stampCompassLoadSource(sheetId, sourceName!, payload, scope?.projectId ?? null);
  // 大表导入的落盘是排队写的:等它走完再说"装好了"(实测截断过一次,49,350 → 39,685)
  await flushTablePersist();

  return {
    ok: true as const,
    sheet: sheetId,
    imported: rows.length,
    total: (payload['total'] as number | undefined) ?? rows.length,
    columns: result?.columns?.length ?? columns.length,
  };
}

export const WORKORDERS_SHEET_ID = 'workorders';

/**
 * 派工焦段:把整个场景的三级(设备级工序工单)作为**主行集**装进 `workorders` sheet。
 *
 * 与 master-detail 抽屉的区别不是显示样式,是**谁是主行集**:抽屉里的子行不参与主表的
 * 排序/筛选/分组,所以「这周哪台压机堵了」在抽屉里问不出来 —— 那得让三级自己当主行集。
 * 反过来,「这一单到哪了」用抽屉更好,不必离开订单层。两个都要,各管一件事。
 *
 * Compass 侧同一个端点按有无单据范围区分两种模式(见 joint_service.work_order_rows_payload)。
 */
export async function importCompassWorkorderSheet(
  getMcpToolsets: ToolsetsGetter | undefined,
  input: { limit?: number; resource?: string; status?: string },
  getMcpGroups?: GroupsGetter,
  scope?: CompassLoadScope,
  seams: { fetchImpl?: typeof fetch } = {},
): Promise<
  | { ok: true; sheet: string; imported: number; total: number; columns: number }
  | { ok: false; error: string }
> {
  const sheetScope = compassSheetScope(scope);
  if (!sheetScope) return { ok: false as const, error: NO_PROJECT_ERROR };
  const params = {
    limit: input.limit ?? 1_000_000,
    resource: input.resource,
    status: input.status,
  };
  let payload: Record<string, unknown> | undefined;
  let sourceName: string | undefined;
  if (scope?.rest) {
    const r = await fetchCompassData(scope.rest, '/data/workorder-rows', params, seams);
    if (r.ok) {
      payload = r.payload;
      sourceName = scope.entryPin ?? 'compass';
    } else {
      console.warn('[table-tools] compass data-plane fetch failed, falling back to MCP:', r.error);
    }
  }
  if (!payload) {
    const compass = resolveCompassToolset(getMcpToolsets, getMcpGroups, scope);
    const tool = compass?.toolset['get_workorder_rows'];
    if (!compass || !tool) {
      return { ok: false as const, error: 'compass MCP server not connected (no get_workorder_rows)' };
    }
    const res: unknown = await tool.execute(params);
    payload = unwrapMcpPayload(res);
    sourceName = compass.serverName;
  }

  const columns = (payload['columns'] as Array<Record<string, unknown>> | undefined) ?? [];
  const rows = (payload['rows'] as Array<Record<string, unknown>> | undefined) ?? [];
  const sheetId = ensureCompassSheet(WORKORDERS_SHEET_ID, '派工', sheetScope);
  const descriptors = compassColumnDescriptors(columns);
  const result = importTableSheet(
    sheetId,
    [],
    rows as Array<Record<string, string | number>>,
    undefined,
    descriptors,
  );
  await stampCompassLoadSource(sheetId, sourceName!, payload, scope?.projectId ?? null);
  // 大表导入的落盘是排队写的:等它走完再说"装好了"(实测截断过一次,49,350 → 39,685)
  await flushTablePersist();

  return {
    ok: true as const,
    sheet: sheetId,
    imported: rows.length,
    // Compass 报的是筛完、切页前的真数。装进来的是 imported —— 两个数不合并,
    // 合并了就等于把"装了 500 行"说成"一共 500 行"。
    total: (payload['total'] as number | undefined) ?? rows.length,
    columns: result?.columns?.length ?? descriptors.length,
  };
}

export const RESOURCES_SHEET_ID = 'resources';

export async function importCompassResourceSheet(
  getMcpToolsets: ToolsetsGetter | undefined,
  getMcpGroups?: GroupsGetter,
  scope?: CompassLoadScope,
): Promise<
  | { ok: true; sheet: string; imported: number }
  | { ok: false; error: string }
> {
  const sheetScope = compassSheetScope(scope);
  if (!sheetScope) return { ok: false as const, error: NO_PROJECT_ERROR };
  const compass = resolveCompassToolset(getMcpToolsets, getMcpGroups, scope);
  const tool = compass?.toolset['get_resources'];
  if (!compass || !tool) {
    return { ok: false as const, error: 'compass MCP server not connected (no get_resources)' };
  }

  const res: unknown = await tool.execute({});
  const payload = unwrapMcpPayload(res);
  const resources =
    (payload['resources'] as Array<Record<string, unknown>> | undefined) ?? [];

  const sheetId = ensureCompassSheet(RESOURCES_SHEET_ID, '资源', sheetScope);

  // Compass's per-resource `trend` is a 12-month forward load series (array);
  // store it as the sparkline column's comma-separated form.
  const rows = resources.map((r) => ({
    resource: String(r['resource'] ?? ''),
    trend: Array.isArray(r['trend']) ? (r['trend'] as number[]).join(',') : '',
    current_k: (r['current_k'] as number | null) ?? '',
    suggested_min_k: (r['suggested_min_k'] as number | null) ?? '',
    jobs: (r['jobs'] as number | null) ?? '',
    load_days: (r['load_days'] as number | null) ?? '',
    source: String(r['source'] ?? ''),
  }));

  const descriptors = [
    { key: 'resource', name: '资源', type: 'text' as const },
    { key: 'trend', name: '负荷趋势(12月)', type: 'sparkline' as const },
    { key: 'current_k', name: '当前K', type: 'number' as const },
    { key: 'suggested_min_k', name: '建议最小K', type: 'number' as const },
    { key: 'jobs', name: '工序数', type: 'number' as const },
    { key: 'load_days', name: '负荷(天)', type: 'number' as const },
    { key: 'source', name: '来源', type: 'text' as const },
  ];
  importTableSheet(sheetId, [], rows, undefined, descriptors);
  await stampCompassLoadSource(sheetId, compass.serverName, payload, scope?.projectId ?? null);
  await flushTablePersist();
  return { ok: true as const, sheet: sheetId, imported: rows.length };
}

export const ORDERS_SHEET_ID = 'orders';

// Per-order overview: one row per 订单 (aggregated from the per-工序 schedule rows).
// Master-detail on this sheet reuses the schedule-detail fetch, but since order
// rows carry order_id and NO stage_code, it returns the order's FULL 三级 route.
export async function importCompassOrderSheet(
  getMcpToolsets: ToolsetsGetter | undefined,
  getMcpGroups?: GroupsGetter,
  scope?: CompassLoadScope,
  seams: { fetchImpl?: typeof fetch } = {},
): Promise<
  | { ok: true; sheet: string; imported: number; total: number; columns: number }
  | { ok: false; error: string }
> {
  const sheetScope = compassSheetScope(scope);
  if (!sheetScope) return { ok: false as const, error: NO_PROJECT_ERROR };
  let payload: Record<string, unknown> | undefined;
  let sourceName: string | undefined;
  if (scope?.rest) {
    // Data-plane first (spec 2026-08-06 ①) — same endpoint as the schedule
    // sheet, just aggregated client-side below; only `limit` is meaningful here.
    const r = await fetchCompassData(scope.rest, '/data/schedule-rows', { limit: 1_000_000 }, seams);
    if (r.ok) {
      payload = r.payload;
      sourceName = scope.entryPin ?? 'compass';
    } else {
      console.warn('[table-tools] compass data-plane fetch failed, falling back to MCP:', r.error);
    }
  }
  if (!payload) {
    const compass = resolveCompassToolset(getMcpToolsets, getMcpGroups, scope);
    const tool = compass?.toolset['get_schedule_rows'];
    if (!compass || !tool) {
      return { ok: false as const, error: 'compass MCP server not connected (no get_schedule_rows)' };
    }
    const res: unknown = await tool.execute({ limit: 1_000_000 });
    payload = unwrapMcpPayload(res);
    sourceName = compass.serverName;
  }
  const rows = (payload['rows'] as Array<Record<string, unknown>> | undefined) ?? [];

  // Aggregate the per-工序 rows into one row per order.
  const STATUS_RANK: Record<string, number> = { unscheduled: 3, derived: 2, solved: 1 };
  type Agg = {
    order_id: string; product_class: string; due_at: string | null; end: string | null;
    schedule_status: string; workshops: Set<string>; stage_count: number; _wo_count: number;
  };
  const byOrder = new Map<string, Agg>();
  for (const r of rows) {
    const oid = String(r['order_id'] ?? '');
    if (!oid) continue;
    let o = byOrder.get(oid);
    if (!o) {
      o = {
        order_id: oid, product_class: String(r['product_class'] ?? ''),
        due_at: (r['due_at'] as string | null) ?? null, end: null,
        schedule_status: 'solved', workshops: new Set(), stage_count: 0,
        _wo_count: Number(r['_wo_count'] ?? 0),
      };
      byOrder.set(oid, o);
    }
    o.stage_count += 1;
    if (r['workshop']) o.workshops.add(String(r['workshop']));
    const end = r['end'] as string | null;
    if (end && (!o.end || String(end) > String(o.end))) o.end = end;   // latest stage end = order 完工
    const st = String(r['schedule_status'] ?? 'solved');
    if ((STATUS_RANK[st] ?? 0) > (STATUS_RANK[o.schedule_status] ?? 0)) o.schedule_status = st;
  }
  const orderRows = [...byOrder.values()].map((o) => ({
    order_id: o.order_id, product_class: o.product_class, workshop: [...o.workshops].join('/'),
    stage_count: o.stage_count, schedule_status: o.schedule_status,
    end: o.end, due_at: o.due_at, _wo_count: o._wo_count,
  }));

  // Reuse the schedule_status tone map Compass shipped on the source columns, so the
  // orders sheet colours identically to the schedule sheet — no domain map re-hardcoded here.
  const srcColumns = (payload['columns'] as Array<Record<string, unknown>> | undefined) ?? [];
  const srcSem = srcColumns.find((c) => c['key'] === 'schedule_status')?.['semantics'];
  const statusSemantics =
    srcSem && typeof srcSem === 'object' ? (srcSem as Record<string, string>) : undefined;
  const descriptors = [
    { key: 'order_id', name: '订单号', type: 'text' as const },
    { key: 'product_class', name: '产品', type: 'text' as const },
    { key: 'workshop', name: '分厂', type: 'text' as const },
    { key: 'stage_count', name: '工序数', type: 'number' as const },
    { key: 'schedule_status', name: '排产状态', type: 'status' as const, semantics: statusSemantics },
    { key: 'end', name: '计划完工', type: 'text' as const },
    { key: 'due_at', name: '交期', type: 'text' as const },
  ];
  const sheetId = ensureCompassSheet(ORDERS_SHEET_ID, '订单', sheetScope);
  importTableSheet(sheetId, [], orderRows as Array<Record<string, string | number>>, undefined, descriptors);
  await stampCompassLoadSource(sheetId, sourceName!, payload, scope?.projectId ?? null);
  // 大表导入的落盘是排队写的:等它走完再说"装好了"(实测截断过一次,49,350 → 39,685)
  await flushTablePersist();
  return {
    ok: true as const, sheet: ORDERS_SHEET_ID,
    imported: orderRows.length, total: orderRows.length, columns: descriptors.length,
  };
}

/**
 * Generic spreadsheet/table tools backed by the multi-sheet grid store.
 */
export function buildTableTools(getMcpToolsets?: ToolsetsGetter, getMcpGroups?: GroupsGetter) {
  const tableGet = createTool({
    id: 'table_get',
    description:
      'Read rows and column definitions from a table sheet (paginated). ' +
      'Always check totalRows in the response; call again with offset/limit for more. ' +
      'Call table_list_sheets first if sheet id is unknown.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      offset: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe(`Row offset for pagination (default 0).`),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(MAX_TABLE_GET_LIMIT)
        .optional()
        .describe(`Rows per page (default ${DEFAULT_TABLE_GET_LIMIT}, max ${MAX_TABLE_GET_LIMIT}).`),
      selection_id: z
        .string()
        .optional()
        .describe(
          '用户在表格里圈选后 @ 进来的选区 id(形如 @表格[… #a1b2c3d4] 里的那串)。'
          + '给了它就只返回选中的行与列 —— 取的是**当前值**,不是圈选那一刻的快照。',
        ),
    }),
    outputSchema: z.object({
      sheet: z.string(),
      totalRows: z.number().optional(),
      offset: z.number().optional(),
      limit: z.number().optional(),
      hasMore: z.boolean().optional(),
      columns: z
        .array(z.object({ key: z.string(), name: z.string(), type: z.string() }))
        .optional(),
      rows: z.array(rowSchema).optional(),
      notice: z.string().optional(),
      source: z
        .object({
          server: z.string(),
          project: z
            .string()
            .optional()
            .describe('Pinned project id at load time (v3 durable provenance identity).'),
          tenant: z.string().optional(),
          loadedAt: z.string(),
        })
        .optional()
        .describe('Load provenance, verbatim from sheet metadata. Absent on legacy unstamped sheets.'),
      warning: z
        .string()
        .optional()
        .describe('Present when this sheet\'s provenance conflicts with (or is missing under) the current project pin.'),
      refused: z
        .boolean()
        .optional()
        .describe(
          'True when the sheet\'s stamped source names a different project than the current pin — ' +
            'rows are withheld entirely (not just warned about); reload the sheet under the correct project.',
        ),
    }),
    execute: async (input, ctx?: TableToolCtx) => {
      const sheet = resolveTableSheetId(input.sheet, scopeFromCtx(ctx));
      const source = getTableSheetMeta(sheet)?.source ?? undefined;
      // v3: both pin and stamp are PROJECT ids; tenantProjects feeds the
      // legacy-stamp shim (see isProjectPinMismatch's re-key note).
      const projectPin = readProjectPin(ctx);
      const tenantProjects = readTenantProjects(ctx);

      // Hard refusal (audit fix #2): a STAMPED mismatch means we positively
      // know these rows belong to a different project — withhold them
      // entirely rather than let the agent treat a warning as optional
      // context. Legacy unstamped sheets fall through to the soft warning
      // below (buildProvenanceWarning's "本表无来源记录" branch).
      if (isProjectPinMismatch(source, projectPin, tenantProjects)) {
        return {
          sheet,
          refused: true,
          warning: `${buildProvenanceWarning(source, projectPin, tenantProjects)} — 请在当前项目下重新加载`,
        };
      }

      // G1: no project pin at all (个人 area, or a call outside a chat turn) +
      // a STAMPED sheet = project data with no project in scope. Withheld for
      // the same reason the grouped MCP servers are: the alternative — which is
      // what shipped until now — is the agent quietly narrating an analysis off
      // a project's stale sheet with nothing telling the user it had no
      // Compass basis. Unstamped (personal) sheets fall through untouched.
      if (isUnscopedProjectData(source, projectPin)) {
        return { sheet, refused: true, warning: buildUnscopedProjectDataWarning(source!) };
      }

      // z.coerce.number() already validated string→number; Number() re-narrows the
      // zod-v4 `unknown` input type to a clean number (idempotent at runtime).
      // 选区引用:用户圈的那块。**按引用取当前值**,而不是把圈选那一刻的数据塞进
      // 对话 —— 后者五分钟后就成了假话(与 G1 同一个病)。
      const selection = input.selection_id
        ? getSelection(readThreadId(ctx) ?? '', String(input.selection_id))
        : undefined;
      if (input.selection_id && !selection) {
        return {
          sheet,
          warning: `选区 #${String(input.selection_id).trim().replace(/^#+/, '')}`
            + ' 不在本会话里(可能已过期或属于别的会话);请让用户重新圈选。',
        };
      }

      const offset = Number(input.offset ?? 0);
      const limit = Number(input.limit ?? DEFAULT_TABLE_GET_LIMIT);
      const page = listTableRowsPage(sheet, offset, limit);
      let { totalRows, rows } = page;
      if (selection) {
        const wanted = new Set(selection.rowKeys);
        const all = listTableRows(sheet).filter((r) => wanted.has(tableRowKey(r)));
        rows = selection.columns.length
          ? all.map((r) => Object.fromEntries(
              Object.entries(r).filter(([k]) => k === 'row_id' || selection.columns.includes(k)),
            ) as typeof r)
          : all;
        totalRows = rows.length;
      }
      const hasMore = offset + rows.length < totalRows;
      const warning = buildProvenanceWarning(source, projectPin, tenantProjects);
      return {
        sheet,
        totalRows,
        offset,
        limit,
        hasMore,
        columns: listTableColumns(sheet).map((c) => ({
          key: c.key,
          name: c.name,
          type: c.type,
        })),
        rows,
        ...(source ? { source } : {}),
        ...(warning ? { warning } : {}),
        ...(hasMore
          ? {
              notice:
                `Showing rows ${offset + 1}–${offset + rows.length} of ${totalRows}. ` +
                `Call table_get again with offset=${offset + rows.length} for the next page.`,
            }
          : totalRows === 0
            ? {
                notice:
                  'This sheet has zero rows in the server table store. ' +
                  'If the UI shows data, confirm the correct sheet id via table_list_sheets.',
              }
            : {}),
      };
    },
  });

  const tableUpdateRow = createTool({
    id: 'table_update_row',
    description:
      'Update multiple cells on one row. Identify the row with row_key (row_id or primary key column value).',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      row_key: z.string().describe('Row id or primary key value from table_get.'),
      values: rowSchema.describe('Column key → new value. Only include columns to change.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      row: rowSchema.nullable(),
      message: z.string(),
    }),
    execute: async (input, ctx?: TableToolCtx) => {
      const sheet = resolveTableSheetId(input.sheet, scopeFromCtx(ctx));
      const updated = await updateTableRow(input.row_key, input.values, sheet);
      if (!updated) {
        return { ok: false, sheet, row: null, message: `Row ${input.row_key} not found` };
      }
      return { ok: true, sheet, row: updated, message: `Updated row ${input.row_key}` };
    },
  });

  const tableSetCell = createTool({
    id: 'table_set_cell',
    description:
      'Write a single cell. Use row_key from table_get; column is a column key from the same sheet.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      row_key: z.string().describe('Row id or primary key value.'),
      column: z.string().describe('Column key to write.'),
      value: cellValueSchema.describe('New cell value.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      row: rowSchema.nullable(),
      message: z.string(),
    }),
    execute: async (input, ctx?: TableToolCtx) => {
      const sheet = resolveTableSheetId(input.sheet, scopeFromCtx(ctx));
      const updated = await updateTableRow(
        input.row_key,
        { [input.column]: input.value },
        sheet,
      );
      if (!updated) {
        return { ok: false, sheet, row: null, message: `Row ${input.row_key} not found` };
      }
      return {
        ok: true,
        sheet,
        row: updated,
        message: `Updated ${input.row_key}.${input.column}`,
      };
    },
  });

  const tableAddRow = createTool({
    id: 'table_add_row',
    description: 'Append a blank row. Returns row_key for table_set_cell / table_update_row.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      row: rowSchema.nullable(),
      message: z.string(),
    }),
    execute: async (input, ctx?: TableToolCtx) => {
      const sheet = resolveTableSheetId(input.sheet, scopeFromCtx(ctx));
      const row = addTableRow(sheet);
      if (!row) return { ok: false, sheet, row: null, message: 'Failed to add row' };
      return { ok: true, sheet, row, message: 'Added a blank row' };
    },
  });

  const tableDeleteRows = createTool({
    id: 'table_delete_rows',
    description: 'Delete rows by row_key values.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      row_keys: z.array(z.string()).min(1).describe('Row ids or primary keys to delete.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      removed: z.number(),
      message: z.string(),
    }),
    execute: async (input, ctx?: TableToolCtx) => {
      const sheet = resolveTableSheetId(input.sheet, scopeFromCtx(ctx));
      const { removed } = deleteTableRows(sheet, input.row_keys);
      return { ok: removed > 0, sheet, removed, message: `Deleted ${removed} row(s)` };
    },
  });

  const tableAddColumn = createTool({
    id: 'table_add_column',
    description: 'Add a new text column to a sheet.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      name: z.string().describe('Column display name.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      column: z.object({ key: z.string(), name: z.string() }).nullable(),
      message: z.string(),
    }),
    execute: async (input, ctx?: TableToolCtx) => {
      const sheet = resolveTableSheetId(input.sheet, scopeFromCtx(ctx));
      const column = addTableColumn(sheet, input.name);
      if (!column) return { ok: false, sheet, column: null, message: 'Failed to add column' };
      return {
        ok: true,
        sheet,
        column: { key: column.key, name: column.name },
        message: `Added column ${column.name}`,
      };
    },
  });

  const tableDeleteColumn = createTool({
    id: 'table_delete_column',
    description: 'Delete a column by its key. Frozen columns cannot be deleted.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      column: z.string().describe('Column key to delete.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      message: z.string(),
    }),
    execute: async (input, ctx?: TableToolCtx) => {
      const sheet = resolveTableSheetId(input.sheet, scopeFromCtx(ctx));
      const ok = deleteTableColumn(sheet, input.column);
      return {
        ok,
        sheet,
        message: ok ? `Deleted column ${input.column}` : `Failed to delete column ${input.column}`,
      };
    },
  });

  const tableCreateSheet = createTool({
    id: 'table_create_sheet',
    description: 'Create a new sheet (tab) with the default column schema.',
    inputSchema: z.object({
      name: z.string().describe('Sheet display name.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.object({ id: z.string(), name: z.string() }).nullable(),
      message: z.string(),
    }),
    execute: async (input, ctx?: TableToolCtx) => {
      const sheet = createTableSheet(input.name, scopeFromCtx(ctx));
      if (!sheet) return { ok: false, sheet: null, message: 'Failed to create sheet' };
      return { ok: true, sheet: { id: sheet.id, name: sheet.name }, message: `Created sheet ${sheet.name}` };
    },
  });

  const tableDeleteSheet = createTool({
    id: 'table_delete_sheet',
    description: 'Delete a sheet by id. At least one sheet must remain.',
    inputSchema: z.object({
      sheet: z.string().describe('Sheet id to delete.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      message: z.string(),
    }),
    execute: async (input, ctx?: TableToolCtx) => {
      const id = resolveTableSheetId(input.sheet, scopeFromCtx(ctx));
      const ok = await deleteTableSheet(id);
      return { ok, message: ok ? `Deleted sheet ${input.sheet}` : 'Failed to delete sheet' };
    },
  });

  const tableListSheets = createTool({
    id: 'table_list_sheets',
    description: 'List available table sheets (tabs).',
    inputSchema: z.object({}),
    outputSchema: z.object({
      sheets: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          builtin: z.boolean(),
        }),
      ),
    }),
    execute: async () => ({ sheets: listTableSheets() }),
  });

  const loadCompassSchedule = createTool({
    id: 'load_compass_schedule',
    description:
      '从 Compass 拉取本租户的排产网格行，写入名为 schedule 的表 sheet 供展示。' +
      ' 需要 Compass MCP 服务器已连接。',
    inputSchema: z.object({
      limit: z.coerce.number().int().min(1).optional().describe('最多返回多少行（默认 500）'),
      workshop: z.string().optional().describe('按车间过滤'),
      status: z.string().optional().describe('按状态过滤'),
      order_id: z.string().optional().describe('按订单号过滤'),
    }),
    execute: async (input, ctx?: TableToolCtx) =>
      importCompassScheduleSheet(
        getMcpToolsets,
        {
          ...input,
          limit: input.limit == null ? undefined : Number(input.limit),
        },
        getMcpGroups,
        compassScopeFromCtx(ctx),
      ),
  });

  const tableChart = createTool({
    id: 'table_chart',
    description:
      '在表格面板上就地生成一张图表（AG-Grid 集成图表）。给定 sheet 与列名，' +
      '第一列作为类目轴，其余数值列作为序列。适合"画个各资源负荷图"这类请求。',
    inputSchema: z.object({
      sheet: z.string().optional().describe('sheet 名（默认当前主 sheet）'),
      columns: z
        .array(z.string())
        .min(2)
        .describe('参与图表的列 key（第一列=类目，如 ["resource","load_days"]）'),
      chart_type: z
        .enum(['column', 'bar', 'line', 'area', 'pie'])
        .optional()
        .describe('图表类型，默认 column'),
      agg_func: z
        .enum(['sum', 'avg', 'min', 'max', 'count'])
        .optional()
        .describe('数值聚合（配合分组时用）'),
    }),
    execute: async (input, ctx?: TableToolCtx) => {
      const sheet = resolveTableSheetId(input.sheet, scopeFromCtx(ctx));
      const known = new Set(listTableColumns(sheet).map((c) => c.key));
      const missing = input.columns.filter((c) => !known.has(c));
      if (missing.length) {
        return {
          ok: false as const,
          error: `sheet '${sheet}' 没有这些列: ${missing.join(', ')}. 可用列: ${[...known].join(', ')}`,
        };
      }
      emitTableChart({
        type: 'chart',
        sheet,
        columns: input.columns,
        chartType: input.chart_type ?? 'column',
        aggFunc: input.agg_func,
      });
      return { ok: true as const, sheet, columns: input.columns, chart: input.chart_type ?? 'column' };
    },
  });

  const loadCompassOrders = createTool({
    id: 'load_compass_orders',
    description:
      '从 Compass 拉取本租户的订单总览（每订单一行：产品/分厂/工序数/排产状态/计划完工/交期），' +
      '写入名为 orders 的表 sheet。展开一行 = 该订单的完整三级工艺路线。需要 Compass MCP 已连接。',
    inputSchema: z.object({}),
    execute: async (_input, ctx?: TableToolCtx) =>
      importCompassOrderSheet(getMcpToolsets, getMcpGroups, compassScopeFromCtx(ctx)),
  });

  const loadCompassWorkorders = createTool({
    id: 'load_compass_workorders',
    description:
      '从 Compass 拉取本场景的三级派工行（每道现场工序一行：WBS/工序/设备工作中心/状态/计划与实际起止），' +
      '写入名为 workorders 的表 sheet。这是把三级当**主行集**看——适合「哪台设备上堆了多少活」' +
      '这类跨订单的问题；只想看某一单下面的三级，展开该订单那一行即可，不必装这张表。',
    inputSchema: z.object({
      resource: z.string().optional().describe('只看某台设备/工作中心（可选）'),
      status: z.string().optional().describe('只看某个执行状态（可选）'),
    }),
    execute: async (input, ctx?: TableToolCtx) =>
      importCompassWorkorderSheet(
        getMcpToolsets,
        { resource: input.resource, status: input.status },
        getMcpGroups,
        compassScopeFromCtx(ctx),
      ),
  });

  const loadCompassResources = createTool({
    id: 'load_compass_resources',
    description:
      '从 Compass 拉取本租户的资源负荷台账（每资源：当前K/建议K/负荷 + 未来12个月负荷趋势），' +
      '写入名为 resources 的表 sheet 供展示（趋势列为迷你图）。需要 Compass MCP 服务器已连接。',
    inputSchema: z.object({}),
    execute: async (_input, ctx?: TableToolCtx) =>
      importCompassResourceSheet(getMcpToolsets, getMcpGroups, compassScopeFromCtx(ctx)),
  });

  return {
    table_get: tableGet,
    table_update_row: tableUpdateRow,
    table_set_cell: tableSetCell,
    table_add_row: tableAddRow,
    table_delete_rows: tableDeleteRows,
    table_add_column: tableAddColumn,
    table_delete_column: tableDeleteColumn,
    table_create_sheet: tableCreateSheet,
    table_delete_sheet: tableDeleteSheet,
    table_list_sheets: tableListSheets,
    load_compass_schedule: loadCompassSchedule,
    load_compass_orders: loadCompassOrders,
    load_compass_workorders: loadCompassWorkorders,
    load_compass_resources: loadCompassResources,
    table_chart: tableChart,
  };
}
