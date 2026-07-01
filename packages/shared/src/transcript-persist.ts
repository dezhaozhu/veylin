/** Round-trip helpers for client-authoritative transcript persistence. */

export const TRANSCRIPT_META_PART_TYPE = 'data-veylin-transcript-meta';
export const STEP_BOUNDARY_PART_TYPE = 'data-veylin-step-boundary';

export type TranscriptMeta = {
  sentAt?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

export function readTranscriptMetaFromMetadata(metadata: unknown): TranscriptMeta | undefined {
  if (!isRecord(metadata)) return undefined;
  const custom = metadata.custom;
  if (!isRecord(custom)) return undefined;
  const sentAt = custom.sentAt;
  if (typeof sentAt === 'number' && Number.isFinite(sentAt)) {
    return { sentAt };
  }
  return undefined;
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
      const sentAt = part.data.sentAt;
      if (typeof sentAt === 'number' && Number.isFinite(sentAt)) {
        meta = { sentAt };
      }
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
  if (meta?.sentAt != null) {
    encoded.push({
      type: TRANSCRIPT_META_PART_TYPE,
      data: { sentAt: meta.sentAt },
    });
  }

  return encoded;
}
