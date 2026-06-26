import jmespath from 'jmespath';
import { minimatch } from 'minimatch';

/**
 * JMESPath filter evaluation aligned with OpenHands automation filter_eval.
 * Supports custom helpers: glob, icontains, regex, lower, upper, starts_with, ends_with.
 */
export class WebhookFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookFilterError';
  }
}

type FilterFn = (args: unknown[]) => unknown;

const FILTER_FUNCTIONS: Record<string, FilterFn> = {
  glob: ([subject, pattern]) =>
    typeof subject === 'string' && typeof pattern === 'string'
      ? minimatch(subject, pattern)
      : false,
  icontains: ([subject, substring]) =>
    typeof subject === 'string' && typeof substring === 'string'
      ? subject.toLowerCase().includes(substring.toLowerCase())
      : false,
  regex: ([subject, pattern]) => {
    if (typeof subject !== 'string' || typeof pattern !== 'string') return false;
    try {
      return new RegExp(pattern).test(subject);
    } catch {
      return false;
    }
  },
  lower: ([subject]) => (typeof subject === 'string' ? subject.toLowerCase() : ''),
  upper: ([subject]) => (typeof subject === 'string' ? subject.toUpperCase() : ''),
  starts_with: ([subject, prefix]) =>
    typeof subject === 'string' && typeof prefix === 'string' ? subject.startsWith(prefix) : false,
  ends_with: ([subject, suffix]) =>
    typeof subject === 'string' && typeof suffix === 'string' ? subject.endsWith(suffix) : false,
};

function compileFilterExpression(expression: string): (payload: Record<string, unknown>) => unknown {
  const fnCall = expression.match(/^([a-z_]+)\((.*)\)$/s);
  if (fnCall) {
    const [, name, inner] = fnCall;
    const fn = FILTER_FUNCTIONS[name!];
    if (!fn) throw new WebhookFilterError(`Unknown filter function: ${name}`);
    const args = splitTopLevelArgs(inner!).map((arg) => compileArg(arg));
    return (payload) => fn(args.map((a) => (typeof a === 'function' ? a(payload) : a)));
  }

  try {
    return (payload) => jmespath.search(payload, expression);
  } catch (err) {
    throw new WebhookFilterError(
      `Invalid filter expression: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function compileArg(arg: string): unknown | ((payload: Record<string, unknown>) => unknown) {
  const trimmed = arg.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return (payload: Record<string, unknown>) => jmespath.search(payload, trimmed);
}

function splitTopLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let quote: "'" | '"' | null = null;

  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

const filterCache = new Map<string, (payload: Record<string, unknown>) => unknown>();

function getFilterEvaluator(expression: string) {
  let evaluator = filterCache.get(expression);
  if (!evaluator) {
    evaluator = compileFilterExpression(expression);
    filterCache.set(expression, evaluator);
  }
  return evaluator;
}

export function validateWebhookFilter(expression: string): { ok: true } | { ok: false; error: string } {
  try {
    evaluateWebhookFilter(expression, {
      name: 'alpha',
      repository: { full_name: 'org/repo' },
      comment: { body: 'hello' },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function evaluateWebhookFilter(expression: string, payload: Record<string, unknown>): boolean {
  const trimmed = expression.trim();
  if (!trimmed) return true;

  if (trimmed.includes('&&')) {
    return trimmed
      .split('&&')
      .map((part) => part.trim())
      .every((part) => evaluateWebhookFilter(part, payload));
  }
  if (trimmed.includes('||')) {
    return trimmed
      .split('||')
      .map((part) => part.trim())
      .some((part) => evaluateWebhookFilter(part, payload));
  }
  if (trimmed.startsWith('!')) {
    return !evaluateWebhookFilter(trimmed.slice(1).trim(), payload);
  }

  try {
    return Boolean(getFilterEvaluator(trimmed)(payload));
  } catch (err) {
    throw new WebhookFilterError(err instanceof Error ? err.message : String(err));
  }
}

export function extractEventKey(expression: string, payload: Record<string, unknown>): string {
  try {
    const value = jmespath.search(payload, expression);
    if (value == null || value === '') return 'unknown';
    return String(value);
  } catch (err) {
    throw new WebhookFilterError(
      `Invalid event_key_expr: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
