export type ComposerSubmitKeyState = {
  isRunning: boolean;
  canQueue: boolean;
  composerEmpty: boolean;
};

export type ComposerKeyEvent = {
  isComposing?: boolean;
  key: string;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
};

/** True while an IME (e.g. Pinyin) composition is active — Enter must not submit. */
export function isImeComposing(event: ComposerKeyEvent): boolean {
  if (event.isComposing || event.nativeEvent?.isComposing) return true;
  if (event.key === 'Process') return true;
  // WebKit / legacy IME
  if (event.keyCode === 229) return true;
  return false;
}

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
