/**
 * B2 governed schedule editing — the four Compass edit fields and the mapping
 * from an AG-Grid cell edit to a /api/schedule-edit/propose body.
 * Job-level fields identify the row by job_id; due_at is order-level (order_id).
 */
export const GOVERNED_EDIT_FIELDS = new Set([
  'resource',
  'std_duration_days',
  'is_bottleneck',
  'due_at',
]);

export type GovernedEditBody = {
  field: string;
  job_id?: string;
  order_id?: string;
  value: string | number | boolean;
};

const TRUTHY_STRINGS = new Set(['true', '1', 'yes', '是', 'y']);

export function buildGovernedEditBody(
  row: Record<string, unknown>,
  columnKey: string,
  value: string | number,
): GovernedEditBody | null {
  if (!GOVERNED_EDIT_FIELDS.has(columnKey)) return null;
  if (columnKey === 'due_at') {
    const orderId = row['order_id'];
    if (orderId == null || orderId === '') return null;
    return { field: 'due_at', order_id: String(orderId), value };
  }
  const jobId = row['job_id'];
  if (jobId == null || jobId === '') return null;
  const coerced =
    columnKey === 'std_duration_days'
      ? Number(value)
      : columnKey === 'is_bottleneck'
        ? TRUTHY_STRINGS.has(String(value).trim().toLowerCase())
        : value;
  return { field: columnKey, job_id: String(jobId), value: coerced };
}
