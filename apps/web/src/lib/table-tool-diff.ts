export type TableToolDiff = {
  added: number;
  removed: number;
};

const TABLE_MUTATING_TOOLS = new Set([
  'table_set_cell',
  'table_update_row',
  'table_add_row',
  'table_delete_rows',
  'table_add_column',
  'table_delete_column',
  'table_create_sheet',
  'table_delete_sheet',
]);

export function isTableMutatingTool(toolName: string): boolean {
  return TABLE_MUTATING_TOOLS.has(toolName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function resultOk(result: unknown): boolean {
  if (result == null) return false;
  if (!isRecord(result)) return true;
  if ('ok' in result) return result.ok === true;
  return true;
}

/** Empty string / null / undefined count as blank cells. */
export function isBlankCellValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function cellTransitionDiff(before: unknown, after: unknown): TableToolDiff {
  const wasBlank = isBlankCellValue(before);
  const isBlank = isBlankCellValue(after);
  if (wasBlank && isBlank) return { added: 0, removed: 0 };
  if (wasBlank && !isBlank) return { added: 1, removed: 0 };
  if (!wasBlank && isBlank) return { added: 0, removed: 1 };
  // Non-empty → non-empty replacement.
  return { added: 1, removed: 1 };
}

function readAppliedMap(result: unknown, args: unknown, toolName: string): Record<string, unknown> {
  if (isRecord(result) && isRecord(result.applied) && Object.keys(result.applied).length > 0) {
    return result.applied;
  }
  if (toolName === 'table_set_cell' && isRecord(args)) {
    const column = typeof args.column === 'string' ? args.column : null;
    if (column) return { [column]: args.value };
  }
  if (toolName === 'table_update_row' && isRecord(args) && isRecord(args.values)) {
    return args.values;
  }
  return {};
}

function readPreviousMap(result: unknown): Record<string, unknown> {
  if (isRecord(result) && isRecord(result.previous)) return result.previous;
  return {};
}

function diffAppliedCells(args: unknown, result: unknown, toolName: string): TableToolDiff {
  const applied = readAppliedMap(result, args, toolName);
  const previous = readPreviousMap(result);
  let added = 0;
  let removed = 0;
  for (const [key, after] of Object.entries(applied)) {
    const before = key in previous ? previous[key] : '';
    const part = cellTransitionDiff(before, after);
    added += part.added;
    removed += part.removed;
  }
  return { added, removed };
}

/** Cell/structure-unit diff for one successful table mutating tool call. */
export function tableToolDiff(
  toolName: string,
  args: unknown,
  result: unknown,
): TableToolDiff {
  if (!isTableMutatingTool(toolName) || !resultOk(result)) {
    return { added: 0, removed: 0 };
  }

  switch (toolName) {
    case 'table_set_cell':
    case 'table_update_row':
      return diffAppliedCells(args, result, toolName);
    case 'table_add_row':
    case 'table_add_column':
    case 'table_create_sheet':
      return { added: 1, removed: 0 };
    case 'table_delete_column':
    case 'table_delete_sheet':
      return { added: 0, removed: 1 };
    case 'table_delete_rows': {
      if (isRecord(result) && typeof result.removed === 'number' && result.removed > 0) {
        return { added: 0, removed: result.removed };
      }
      if (isRecord(args) && Array.isArray(args.row_keys)) {
        return { added: 0, removed: args.row_keys.length };
      }
      return { added: 0, removed: 0 };
    }
    default:
      return { added: 0, removed: 0 };
  }
}

export function sumTableToolDiffs(
  items: ReadonlyArray<{ toolName: string; args?: unknown; result?: unknown }>,
): TableToolDiff {
  let added = 0;
  let removed = 0;
  for (const item of items) {
    const diff = tableToolDiff(item.toolName, item.args, item.result);
    added += diff.added;
    removed += diff.removed;
  }
  return { added, removed };
}
