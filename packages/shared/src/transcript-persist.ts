/** Round-trip helpers for client-authoritative transcript persistence. */

export const TRANSCRIPT_META_PART_TYPE = 'data-veylin-transcript-meta';
export const STEP_BOUNDARY_PART_TYPE = 'data-veylin-step-boundary';

export type TranscriptMeta = {
  sentAt?: number;
  interrupted?: boolean;
  turnTiming?: PersistedAssistantTurnTiming;
};

export type WorkSegment = {
  key: string;
  kind: 'work' | 'reasoning';
  startedAt: number;
  endedAt: number;
  durationMs: number;
};

export type PersistedAssistantTurnTiming = {
  runId: string;
  phase: 'idle' | 'working' | 'waiting_user' | 'finished' | 'failed';
  accumulatedWorkMs: number;
  segments: WorkSegment[];
  openSegment?: {
    key: string;
    kind: 'work' | 'reasoning';
    startedAt: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function readTurnTiming(value: unknown): PersistedAssistantTurnTiming | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.runId !== 'string' ||
    typeof value.phase !== 'string' ||
    !['idle', 'working', 'waiting_user', 'finished', 'failed'].includes(value.phase) ||
    typeof value.accumulatedWorkMs !== 'number' ||
    !Number.isFinite(value.accumulatedWorkMs) ||
    !Array.isArray(value.segments)
  ) {
    return undefined;
  }
  return value as PersistedAssistantTurnTiming;
}

export function readTranscriptMetaFromMetadata(metadata: unknown): TranscriptMeta | undefined {
  if (!isRecord(metadata)) return undefined;
  const custom = metadata.custom;
  if (!isRecord(custom)) return undefined;
  const meta: TranscriptMeta = {};
  if (typeof custom.sentAt === 'number' && Number.isFinite(custom.sentAt)) {
    meta.sentAt = custom.sentAt;
  }
  if (custom.interrupted === true) {
    meta.interrupted = true;
  }
  const turnTiming = readTurnTiming(custom.turnTiming);
  if (turnTiming) meta.turnTiming = turnTiming;
  return meta.sentAt != null || meta.interrupted || meta.turnTiming ? meta : undefined;
}

export function extractTranscriptEnvelope(parts: unknown[]): {
  parts: unknown[];
  meta?: TranscriptMeta;
} {
  const out: unknown[] = [];
  let meta: TranscriptMeta | undefined;

  for (const part of parts) {
    if (!isRecord(part)) {
      out.push(part);
      continue;
    }
    const type = part.type;
    if (type === TRANSCRIPT_META_PART_TYPE && isRecord(part.data)) {
      const next: TranscriptMeta = { ...(meta ?? {}) };
      const sentAt = part.data.sentAt;
      if (typeof sentAt === 'number' && Number.isFinite(sentAt)) {
        next.sentAt = sentAt;
      }
      if (part.data.interrupted === true) {
        next.interrupted = true;
      }
      const turnTiming = readTurnTiming(part.data.turnTiming);
      if (turnTiming) next.turnTiming = turnTiming;
      meta = next;
      continue;
    }
    if (type === STEP_BOUNDARY_PART_TYPE) {
      out.push({ type: 'step-start' });
      continue;
    }
    out.push(part);
  }

  return { parts: out, meta };
}

export function embedTranscriptEnvelope(
  parts: unknown[],
  metadata?: unknown,
): unknown[] {
  const withoutEnvelope = parts.filter((part) => {
    if (!isRecord(part)) return true;
    const type = part.type;
    return type !== TRANSCRIPT_META_PART_TYPE && type !== STEP_BOUNDARY_PART_TYPE;
  });

  const encoded: unknown[] = [];
  for (const part of withoutEnvelope) {
    if (isRecord(part) && part.type === 'step-start') {
      encoded.push({ type: STEP_BOUNDARY_PART_TYPE });
      continue;
    }
    encoded.push(part);
  }

  const meta = readTranscriptMetaFromMetadata(metadata);
  if (meta?.sentAt != null || meta?.interrupted || meta?.turnTiming) {
    encoded.push({
      type: TRANSCRIPT_META_PART_TYPE,
      data: {
        ...(meta.sentAt != null ? { sentAt: meta.sentAt } : {}),
        ...(meta.interrupted ? { interrupted: true } : {}),
        ...(meta.turnTiming ? { turnTiming: meta.turnTiming } : {}),
      },
    });
  }

  return encoded;
}
