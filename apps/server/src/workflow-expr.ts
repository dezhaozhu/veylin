import type { ComparisonOperator, WorkflowCase, WorkflowCondition } from '@veylin/shared';

export type NodeContext = Record<string, unknown>;

/** Resolve a dot path (a.b.c, a.0.b) against a value. */
export function resolvePath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc)) {
      const idx = Number(key);
      return Number.isInteger(idx) ? acc[idx] : undefined;
    }
    if (typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

/** Resolve "nodeId.field.sub" against the run context. */
export function resolveRef(ctx: NodeContext, ref: string): unknown {
  const trimmed = ref.trim();
  const dot = trimmed.indexOf('.');
  if (dot === -1) return ctx[trimmed];
  const nodeId = trimmed.slice(0, dot);
  const rest = trimmed.slice(dot + 1);
  return resolvePath(ctx[nodeId], rest);
}

/**
 * Resolve a value that may be a literal or a single full-expression `{{ ref }}`.
 * A bare `{{ ref }}` returns the raw (non-stringified) value so downstream
 * nodes can operate on objects/arrays/numbers, mirroring n8n/Dify behavior.
 */
export function resolveValue(ctx: NodeContext, raw: string): unknown {
  const trimmed = raw.trim();
  const full = /^\{\{([^}]+)\}\}$/.exec(trimmed);
  if (full) return resolveRef(ctx, full[1]!);
  return interpolate(raw, ctx);
}

/** Replace all `{{ ref }}` occurrences in a string with their stringified values. */
export function interpolate(text: string, ctx: NodeContext): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, ref: string) => {
    const val = resolveRef(ctx, ref);
    if (val == null) return '';
    return typeof val === 'string' ? val : JSON.stringify(val);
  });
}

/** Deeply interpolate strings inside an arbitrary JSON structure. */
export function interpolateDeep(value: unknown, ctx: NodeContext): unknown {
  if (typeof value === 'string') return resolveValue(ctx, value);
  if (Array.isArray(value)) return value.map((v) => interpolateDeep(v, ctx));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateDeep(v, ctx);
    }
    return out;
  }
  return value;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

/** Evaluate one condition. `left` is already resolved to a runtime value. */
export function evaluateCompare(
  left: unknown,
  operator: ComparisonOperator,
  right: string,
): boolean {
  const leftStr = left == null ? '' : typeof left === 'string' ? left : JSON.stringify(left);
  switch (operator) {
    case 'contains':
      return leftStr.includes(right);
    case 'not_contains':
      return !leftStr.includes(right);
    case 'starts_with':
      return leftStr.startsWith(right);
    case 'ends_with':
      return leftStr.endsWith(right);
    case 'is':
      return leftStr === right;
    case 'is_not':
      return leftStr !== right;
    case 'is_empty':
      return isEmpty(left);
    case 'is_not_empty':
      return !isEmpty(left);
    case 'in': {
      const arr = right.split(',').map((s) => s.trim());
      return arr.includes(leftStr);
    }
    case 'not_in': {
      const arr = right.split(',').map((s) => s.trim());
      return !arr.includes(leftStr);
    }
    case 'eq':
      return toNumber(left) === toNumber(right);
    case 'neq':
      return toNumber(left) !== toNumber(right);
    case 'gt':
      return toNumber(left) > toNumber(right);
    case 'lt':
      return toNumber(left) < toNumber(right);
    case 'gte':
      return toNumber(left) >= toNumber(right);
    case 'lte':
      return toNumber(left) <= toNumber(right);
    case 'is_null':
      return left == null;
    case 'is_not_null':
      return left != null;
    default:
      return false;
  }
}

export function evaluateCondition(ctx: NodeContext, cond: WorkflowCondition): boolean {
  const left = resolveValue(ctx, cond.left ?? '');
  return evaluateCompare(left, cond.operator ?? 'is', cond.right ?? '');
}

export function evaluateCase(ctx: NodeContext, c: WorkflowCase): boolean {
  const conditions = c.conditions ?? [];
  if (conditions.length === 0) return true;
  const results = conditions.map((cond) => evaluateCondition(ctx, cond));
  return (c.logicalOperator ?? 'and') === 'or'
    ? results.some(Boolean)
    : results.every(Boolean);
}
