import type { AppendMessage } from '@assistant-ui/core';

export type ComposerQueueRuntime = {
  getQueuedMessage: (queueItemId: string) => AppendMessage | undefined;
  popQueuedMessage: (queueItemId: string) => AppendMessage | undefined;
};

let activeRuntime: ComposerQueueRuntime | null = null;

export function setComposerQueueRuntime(runtime: ComposerQueueRuntime | null): void {
  activeRuntime = runtime;
}

export function getComposerQueueRuntime(): ComposerQueueRuntime | null {
  return activeRuntime;
}
