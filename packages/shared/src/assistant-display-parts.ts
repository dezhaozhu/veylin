/**
 * Normalize assistant message parts for display and persistence (Claude Code–style turn).
 * - Migrate legacy tool-invocation → tool-{name}
 * - Drop empty reasoning shells; prose lives in text or non-empty reasoning
 * - Dedupe repeated narration across tool-continuation steps
 * - Optionally merge prose across step-start when only narration continues
 */

const FRONTEND_SUSPEND_TOOL_TYPES = new Set([
  'tool-ask_user_question',
  'tool-read_open_page',
]);

export type NormalizeAssistantPartsMode = 'persist' | 'display';

export type NormalizeAssistantPartsOptions = {
  mode?: NormalizeAssistantPartsMode;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function isStepStart(part: unknown): boolean {
  return isRecord(part) && part.type === 'step-start';
}

function isReasoningPart(part: unknown): boolean {
  return isRecord(part) && part.type === 'reasoning';
}

function isTextPart(part: unknown): boolean {
  return isRecord(part) && part.type === 'text';
}

function isReasoningOrText(part: unknown): boolean {
  return isReasoningPart(part) || isTextPart(part);
}

function partText(part: unknown): string {
  if (!isRecord(part)) return '';
  return typeof part.text === 'string' ? part.text.trim() : '';
}

function isToolLikePart(part: unknown): boolean {
  if (!isRecord(part)) return false;
  const type = part.type;
  return typeof type === 'string' && (type.startsWith('tool-') || type === 'tool-invocation');
}

function mapLegacyToolState(state: unknown): string {
  switch (state) {
    case 'result':
      return 'output-available';
    case 'error':
      return 'output-error';
    case 'call':
      return 'input-available';
    default:
      return 'input-streaming';
  }
}

/** Mastra / AI SDK v4-style tool-invocation → current tool-{name} parts. */
export function migrateLegacyToolPart(part: unknown): unknown {
  if (!isRecord(part) || part.type !== 'tool-invocation') return part;

  const inv = part.toolInvocation;
  if (!isRecord(inv)) return part;

  const toolName = typeof inv.toolName === 'string' ? inv.toolName : 'unknown';
  const toolCallId =
    typeof inv.toolCallId === 'string' ? inv.toolCallId : crypto.randomUUID();

  const migrated: Record<string, unknown> = {
    type: `tool-${toolName}`,
    toolCallId,
    state: mapLegacyToolState(inv.state),
    input: inv.args ?? {},
  };

  if (inv.state === 'result') migrated.output = inv.result;
  if (inv.state === 'error') {
    migrated.errorText =
      typeof inv.result === 'string' ? inv.result : JSON.stringify(inv.result ?? 'Tool error');
  }
  if (inv.providerExecuted === true) migrated.providerExecuted = true;

  return migrated;
}

function migrateLegacyTools(parts: readonly unknown[]): unknown[] {
  return parts.map(migrateLegacyToolPart);
}

/** Drop empty reasoning; when reasoning is empty and followed by text, keep text only. */
function coalesceEmptyReasoning(parts: readonly unknown[]): unknown[] {
  const out: unknown[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!isReasoningPart(part) || partText(part)) {
      out.push(part);
      continue;
    }

    const next = parts[i + 1];
    if (isTextPart(next) && partText(next)) {
      out.push(next);
      i += 1;
      continue;
    }

    if (isToolLikePart(next) || isStepStart(next)) {
      continue;
    }
  }

  return out;
}

/**
 * Drop finished empty text shells that would otherwise split adjacent reasoning
 * groups into two Thought blocks (live stream often emits text-start with '').
 */
function coalesceEmptyText(parts: readonly unknown[]): unknown[] {
  const out: unknown[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!isTextPart(part) || partText(part)) {
      out.push(part);
      continue;
    }

    const next = parts[i + 1];
    if (isReasoningPart(next) && partText(next)) {
      continue;
    }
    if (isToolLikePart(next) || isStepStart(next) || isReasoningPart(next)) {
      continue;
    }
    // Trailing empty text at end of message — drop.
  }

  return out;
}

function narrativeKey(parts: readonly unknown[]): string {
  return parts
    .filter(isReasoningOrText)
    .map(partText)
    .filter(Boolean)
    .join('\n');
}

function isCompletedFrontendSuspendTool(part: unknown): boolean {
  if (!isRecord(part)) return false;
  const type = part.type;
  if (typeof type !== 'string' || !FRONTEND_SUSPEND_TOOL_TYPES.has(type)) return false;
  return part.state === 'output-available' || part.state === 'output-error';
}

function splitAssistantSteps(parts: readonly unknown[]): unknown[][] {
  const steps: unknown[][] = [];
  let current: unknown[] = [];

  const pushStep = () => {
    if (current.length > 0) {
      steps.push(current);
      current = [];
    }
  };

  for (const part of parts) {
    if (isStepStart(part)) {
      pushStep();
      continue;
    }

    if (isReasoningOrText(part) && current.some(isCompletedFrontendSuspendTool)) {
      pushStep();
    }

    current.push(part);
  }

  pushStep();
  return steps;
}

function stripDuplicateNarrativePrefix(
  step: readonly unknown[],
  prevNarrative: string,
): unknown[] {
  if (!prevNarrative) return [...step];

  let acc = '';
  const rest: unknown[] = [];
  let stripping = true;

  for (const part of step) {
    if (!stripping || !isReasoningOrText(part)) {
      stripping = false;
      rest.push(part);
      continue;
    }

    const text = partText(part);
    if (!text) continue;

    acc = acc ? `${acc}\n${text}` : text;
    if (acc === prevNarrative) continue;
    if (prevNarrative.startsWith(acc)) continue;

    stripping = false;
    rest.push(part);
  }

  return rest;
}

function dedupeAcrossSteps(parts: readonly unknown[]): unknown[] {
  const condensed: unknown[] = [];
  for (const part of parts) {
    const prev = condensed.at(-1);
    const text = partText(part);
    if (
      prev &&
      isReasoningOrText(prev) &&
      isReasoningOrText(part) &&
      text &&
      partText(prev) === text
    ) {
      continue;
    }
    condensed.push(part);
  }

  const steps = splitAssistantSteps(condensed);
  if (steps.length <= 1) return condensed;

  const out: unknown[] = [];
  let prevNarrative = '';

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const narrative = narrativeKey(step);

    if (i > 0) out.push({ type: 'step-start' });

    if (i > 0 && narrative && prevNarrative) {
      if (narrative === prevNarrative) {
        out.push(...step.filter((p) => !isReasoningOrText(p) && !isStepStart(p)));
        continue;
      }
      if (narrative.startsWith(`${prevNarrative}\n`)) {
        out.push(...stripDuplicateNarrativePrefix(step, prevNarrative));
        prevNarrative = narrative;
        continue;
      }
    }

    out.push(...step);
    if (narrative) prevNarrative = narrative;
  }

  return out;
}

/** Merge assistant prose across step-start when the boundary is narration-only. */
function mergeProseAcrossTextOnlySteps(parts: readonly unknown[]): unknown[] {
  const out: unknown[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    if (isStepStart(part)) {
      const prev = out.at(-1);
      let j = i + 1;
      while (j < parts.length && isStepStart(parts[j]!)) j += 1;
      const next = parts[j];

      if (
        isTextPart(prev) &&
        partText(prev) &&
        isTextPart(next) &&
        partText(next) &&
        !parts.slice(i + 1, j).some((p) => isToolLikePart(p) || isReasoningPart(p))
      ) {
        out[out.length - 1] = {
          ...(prev as Record<string, unknown>),
          text: `${partText(prev)}\n\n${partText(next)}`,
        };
        i = j;
        continue;
      }
    }

    out.push(part);
  }

  return out;
}

function stripStepStarts(parts: readonly unknown[]): unknown[] {
  return parts.filter((part) => !isStepStart(part));
}

function partsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((part, index) => part === b[index]);
}

function partSemanticallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function partsSemanticallyEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((part, index) => partSemanticallyEqual(part, b[index]));
}

/** Compare assistant message parts by structure, not reference identity. */
export function assistantPartsSemanticallyEqual(
  a: readonly unknown[],
  b: readonly unknown[],
): boolean {
  return partsSemanticallyEqual(a, b);
}

function normalizeInner(
  parts: readonly unknown[],
  options: NormalizeAssistantPartsOptions,
): unknown[] {
  const mode = options.mode ?? 'persist';
  let work = migrateLegacyTools(parts);
  work = coalesceEmptyReasoning(work);
  work = coalesceEmptyText(work);
  work = dedupeAcrossSteps(work);
  if (mode === 'display') {
    work = mergeProseAcrossTextOnlySteps(work);
    work = stripStepStarts(work);
  }
  return work;
}

/** Normalize assistant parts for UI or Mastra persistence. */
export function normalizeAssistantMessageParts(
  parts: unknown[] | undefined,
  options: NormalizeAssistantPartsOptions = {},
): unknown[] {
  if (!parts?.length) return parts ?? [];
  const result = normalizeInner(parts, options);
  if (partsEqual(result, parts) || partsSemanticallyEqual(result, parts)) return parts;
  return result;
}

/** @deprecated Use normalizeAssistantMessageParts(parts, { mode: 'persist' }). */
export function dedupeAssistantMessageParts(parts: unknown[] | undefined): unknown[] {
  return normalizeAssistantMessageParts(parts, { mode: 'persist' });
}
