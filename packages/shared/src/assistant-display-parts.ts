/** Collapse duplicate assistant narration across tool-continuation steps (live + reload). */

const FRONTEND_SUSPEND_TOOL_TYPES = new Set([
  'tool-ask_user_question',
  'tool-read_open_page',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function isStepStart(part: unknown): boolean {
  return isRecord(part) && part.type === 'step-start';
}

function isReasoningOrText(part: unknown): boolean {
  if (!isRecord(part)) return false;
  return part.type === 'reasoning' || part.type === 'text';
}

function partText(part: unknown): string {
  if (!isRecord(part)) return '';
  return typeof part.text === 'string' ? part.text.trim() : '';
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
    if (acc === prevNarrative) {
      continue;
    }
    if (prevNarrative.startsWith(acc)) {
      continue;
    }

    stripping = false;
    rest.push(part);
  }

  return rest;
}

function dedupeInner(parts: readonly unknown[]): unknown[] {
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

/** Remove repeated Thought/text blocks after answered ask_user_question continuations. */
export function dedupeAssistantMessageParts(parts: unknown[] | undefined): unknown[] {
  if (!parts?.length) return parts ?? [];
  const result = dedupeInner(parts);
  if (partsEqual(result, parts) || partsSemanticallyEqual(result, parts)) return parts;
  return result;
}
