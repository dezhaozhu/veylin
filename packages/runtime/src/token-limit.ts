/** Input token budget for Mastra TokenLimiter (system + history). */
export function inputTokenLimit(): number {
  const v = Number(process.env.VEYLIN_TOKEN_LIMIT);
  return Number.isFinite(v) && v > 0 ? v : 128_000;
}
