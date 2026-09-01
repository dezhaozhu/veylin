/**
 * 表格日期单元格的显示层。Compass 日期字段常带 `T00:00:00`,对人没有信息,
 * 只留年月日。底层仍存原串,不在这里改数据。
 */
const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function formatTableDateDisplay(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  const raw = String(value);
  const match = raw.match(ISO_DATE_PREFIX);
  return match?.[1] ?? raw;
}
