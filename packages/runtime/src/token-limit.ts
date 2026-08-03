import { getContextWindowSize } from './context-window.js';

/** Input token budget for Mastra TokenLimiter — same resolve as autocompact / ring. */
export function inputTokenLimit(modelKey?: string): number {
  return getContextWindowSize(modelKey);
}
