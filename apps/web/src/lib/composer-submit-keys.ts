export type ComposerSubmitKeyState = {
  isRunning: boolean;
  canQueue: boolean;
  composerEmpty: boolean;
};

/**
 * Enter while the agent is running: always queue, never interrupt the current run.
 * Steering (interrupt + send now) is an explicit action via the queue item's button.
 */
export function resolveEnterWhileRunning(
  state: ComposerSubmitKeyState,
): 'queue' | 'ignore' {
  if (!state.isRunning || !state.canQueue || state.composerEmpty) return 'ignore';
  return 'queue';
}

/** Tab queues the current draft while a run is active. */
export function shouldInterceptTabForQueue(
  state: Pick<ComposerSubmitKeyState, 'isRunning' | 'canQueue' | 'composerEmpty'>,
): boolean {
  return state.isRunning && state.canQueue && !state.composerEmpty;
}
