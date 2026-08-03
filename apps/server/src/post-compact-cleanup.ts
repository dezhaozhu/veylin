import {
  clearSystemPromptSections,
  resetCompactCircuitBreaker,
  resetMicrocompactState,
} from '@veylin/runtime';

/** Reset cached prompt sections and microcompact state after manual or auto compaction. */
export function runPostCompactCleanup(): void {
  clearSystemPromptSections();
  resetMicrocompactState();
  resetCompactCircuitBreaker();
}
