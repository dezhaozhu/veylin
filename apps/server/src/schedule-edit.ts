import type { ToolsetsGetter } from './table-tools.js';

type CompassTool = { execute: (args: unknown) => Promise<unknown> };

function compassTool(
  getToolsets: ToolsetsGetter | undefined,
  name: string,
): CompassTool | null {
  const toolsets = getToolsets?.() ?? {};
  const compass = toolsets['compass'] as Record<string, CompassTool> | undefined;
  return compass?.[name] ?? null;
}

/**
 * Like table-tools.unwrapMcpPayload but for payloads WITHOUT a `columns` key:
 * a direct typed object (no content/text wrapper) passes through as-is; a
 * content[0].text JSON string is parsed; anything else → {}.
 */
export function unwrapMcpResult(res: unknown): Record<string, unknown> {
  if (
    res != null &&
    typeof res === 'object' &&
    !('content' in (res as object)) &&
    !('text' in (res as object))
  ) {
    return res as Record<string, unknown>;
  }
  try {
    const r = res as Record<string, unknown> | null;
    const text =
      (r?.['content'] as Array<Record<string, unknown>> | undefined)?.[0]?.['text'] ??
      r?.['text'] ??
      '{}';
    return JSON.parse(String(text)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export type ProposeEditBody = {
  field: string;
  job_id?: string;
  order_id?: string;
  value: string | number | boolean;
};

export async function proposeScheduleEdit(
  getToolsets: ToolsetsGetter | undefined,
  body: ProposeEditBody,
): Promise<
  | { ok: true; ops: number; note?: unknown }
  | { ok: false; refused?: string; error?: string }
> {
  const tool = compassTool(getToolsets, 'propose_schedule_edit');
  if (!tool) {
    return { ok: false, error: 'compass MCP not connected (no propose_schedule_edit)' };
  }
  const payload = unwrapMcpResult(await tool.execute(body));
  if (payload['refused']) return { ok: false, refused: String(payload['refused']) };
  if (payload['error']) return { ok: false, error: String(payload['error']) };
  return { ok: true, ops: Number(payload['ops'] ?? 0), note: payload['note'] };
}

export async function previewScheduleEdit(
  getToolsets: ToolsetsGetter | undefined,
): Promise<
  | { ok: true; rows: unknown[]; diagnosis: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const tool = compassTool(getToolsets, 'preview_schedule_edit');
  if (!tool) {
    return { ok: false, error: 'compass MCP not connected (no preview_schedule_edit)' };
  }
  const payload = unwrapMcpResult(await tool.execute({}));
  return {
    ok: true,
    rows: (payload['rows'] as unknown[] | undefined) ?? [],
    diagnosis: (payload['diagnosis'] as Record<string, unknown> | undefined) ?? {},
  };
}

export async function commitScheduleEdit(
  getToolsets: ToolsetsGetter | undefined,
): Promise<
  | {
      ok: true;
      committed: number;
      deferred: number;
      proposal_ids: unknown[];
      deferred_ids: unknown[];
      run_id: unknown;
      status: string;
      unscheduled: number;
    }
  | { ok: false; conflict?: true; error?: string; message?: string }
> {
  const tool = compassTool(getToolsets, 'commit_schedule_edit');
  if (!tool) {
    return { ok: false, error: 'compass MCP not connected (no commit_schedule_edit)' };
  }
  const payload = unwrapMcpResult(await tool.execute({}));
  if (payload['conflict']) {
    return {
      ok: false,
      conflict: true,
      error: String(payload['error'] ?? 'conflict'),
      message: String(payload['note'] ?? payload['error'] ?? 'conflict'),
    };
  }
  return {
    ok: true,
    committed: Number(payload['committed'] ?? 0),
    deferred: Number(payload['deferred'] ?? 0),
    proposal_ids: (payload['proposal_ids'] as unknown[] | undefined) ?? [],
    deferred_ids: (payload['deferred_ids'] as unknown[] | undefined) ?? [],
    run_id: payload['run_id'] ?? null,
    status: String(payload['status'] ?? ''),
    unscheduled: Number(payload['unscheduled'] ?? 0),
  };
}

export async function discardScheduleEdits(
  getToolsets: ToolsetsGetter | undefined,
): Promise<{ ok: boolean; error?: string }> {
  const tool = compassTool(getToolsets, 'discard_schedule_edits');
  if (!tool) {
    return { ok: false, error: 'compass MCP not connected (no discard_schedule_edits)' };
  }
  const payload = unwrapMcpResult(await tool.execute({}));
  return { ok: Boolean(payload['discarded']) };
}

/**
 * System-prompt governance block for the chat agent — only when the Compass
 * edit tools are actually connected. Encodes spec §5: never commit without
 * explicit user confirmation.
 */
export function scheduleEditGuidanceBlock(getToolsets: ToolsetsGetter | undefined): string {
  if (!compassTool(getToolsets, 'propose_schedule_edit')) return '';
  return [
    '## 排产编辑治理（Compass）',
    '修改排产数据（资源 resource / 工期 std_duration_days / 瓶颈 is_bottleneck / 交期 due_at）必须走治理流程，绝不允许静默改动生产排程：',
    '1. 用 propose_schedule_edit 把每个修改加入草稿（不生效；job 级字段传 job_id，due_at 传 order_id）。',
    '2. 用 preview_schedule_edit 做影子求解，把影响讲给用户：哪些订单移动、honest_status、unscheduled 数。',
    '3. 必须得到用户明确同意后才可调用 commit_schedule_edit；用户拒绝或改主意时用 discard_schedule_edits 清空草稿。',
    '4. commit 返回 conflict 时，告诉用户排产数据已被他人更改，需要重新 preview 后再提交。',
    '5. 受管控的修改（如交期）commit 后会成为约束提案等待人工审批，不会立即生效——要向用户如实说明。',
  ].join('\n');
}
