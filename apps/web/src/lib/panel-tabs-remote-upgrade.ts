/**
 * Detect local list-item id → server remoteId upgrade (first message / initialize).
 * Must NOT match switching to a different conversation that already has a remoteId.
 */
export function isPanelTabsRemoteUpgrade(args: {
  remoteId: string | null | undefined;
  localId: string | null | undefined;
  prevLocalId: string | null | undefined;
  prevThreadId: string | null | undefined;
  threadId: string | null | undefined;
}): boolean {
  const { remoteId, localId, prevLocalId, prevThreadId, threadId } = args;
  return (
    Boolean(remoteId) &&
    Boolean(prevThreadId) &&
    Boolean(localId) &&
    localId === prevLocalId &&
    prevThreadId === prevLocalId &&
    threadId === remoteId &&
    prevThreadId !== threadId
  );
}
