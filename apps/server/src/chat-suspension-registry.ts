/**
 * Atomic in-process ownership index for native Mastra suspended runs.
 *
 * The durable copy lives in Veylin thread state. Routes hydrate that copy into
 * this index after a process restart, while this map serializes concurrent
 * resume attempts within a process.
 */
export type SuspendedRunOwner = {
  threadId: string;
  tenantId: string;
  resourceOwnerId: string;
  agentId: string;
};

export type SuspendedRunRecord = SuspendedRunOwner & {
  runId: string;
  toolCallId: string;
  suspendPayload: unknown;
  createdAt: number;
};

const MAX_SUSPENSION_AGE_MS = 24 * 60 * 60 * 1_000;
const suspendedRuns = new Map<string, SuspendedRunRecord>();
const consumedRuns = new Map<string, number>();

function key(threadId: string, runId: string): string {
  return `${threadId}\0${runId}`;
}

function pruneExpired(now = Date.now()): void {
  for (const [entryKey, record] of suspendedRuns) {
    if (now - record.createdAt > MAX_SUSPENSION_AGE_MS) {
      suspendedRuns.delete(entryKey);
    }
  }
  for (const [entryKey, consumedAt] of consumedRuns) {
    if (now - consumedAt > MAX_SUSPENSION_AGE_MS) consumedRuns.delete(entryKey);
  }
}

export function registerSuspendedRun(
  record: SuspendedRunRecord,
  options?: { restoreConsumed?: boolean },
): void {
  pruneExpired();
  const entryKey = key(record.threadId, record.runId);
  if (options?.restoreConsumed) consumedRuns.delete(entryKey);
  if (consumedRuns.has(entryKey)) return;
  suspendedRuns.set(entryKey, record);
}

export function observeSuspensionChunk<T>(chunk: T, owner: SuspendedRunOwner): T {
  const part = chunk as {
    type?: string;
    data?: {
      runId?: unknown;
      toolCallId?: unknown;
      suspendPayload?: unknown;
      suspendedAt?: unknown;
    };
  };
  if (
    part.type !== 'data-tool-call-suspended' ||
    typeof part.data?.runId !== 'string' ||
    !part.data.runId ||
    typeof part.data.toolCallId !== 'string' ||
    !part.data.toolCallId
  ) {
    return chunk;
  }

  pruneExpired();
  const suspendedAt =
    typeof part.data.suspendedAt === 'number' ? part.data.suspendedAt : Date.now();
  part.data.suspendedAt = suspendedAt;
  consumedRuns.delete(key(owner.threadId, part.data.runId));
  registerSuspendedRun({
    ...owner,
    runId: part.data.runId,
    toolCallId: part.data.toolCallId,
    suspendPayload: part.data.suspendPayload,
    createdAt: suspendedAt,
  });
  return chunk;
}

/**
 * Atomically validates and consumes a suspended run. Returning null reveals no
 * ownership details and prevents concurrent/double resume.
 */
export function consumeSuspendedRun(
  owner: SuspendedRunOwner,
  runId: string,
  toolCallId?: string,
): SuspendedRunRecord | null {
  pruneExpired();
  const entryKey = key(owner.threadId, runId);
  const record = suspendedRuns.get(entryKey);
  if (
    !record ||
    record.tenantId !== owner.tenantId ||
    record.resourceOwnerId !== owner.resourceOwnerId ||
    record.agentId !== owner.agentId ||
    (toolCallId != null && record.toolCallId !== toolCallId)
  ) {
    return null;
  }
  suspendedRuns.delete(entryKey);
  consumedRuns.set(entryKey, Date.now());
  return record;
}

/** Test-only reset for process-global registry state. */
export function clearSuspendedRunsForTest(): void {
  suspendedRuns.clear();
  consumedRuns.clear();
}
