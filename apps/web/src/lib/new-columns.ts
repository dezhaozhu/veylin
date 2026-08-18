/**
 * 新出现了哪些列。
 *
 * agent 加完列,面板只是把列表换掉 —— 新列常常在横向滚动之外,人看不见,
 * 于是以为"没加上"(用户实测:算完均价说加了备注,他在屏幕上找不到)。
 * 认出新列,才谈得上把视线带过去。
 */
export function newColumnKeys(previous: readonly string[], next: readonly string[]): string[] {
  const had = new Set(previous);
  return next.filter((key) => !had.has(key));
}

/**
 * 该滚到哪一列。
 *
 * **首屏不算**:第一次拿到列(previous 为空)时,每一列都是"新"的,滚过去毫无
 * 意义还会把视线甩到最右边。只有在已有列的基础上多出来的,才值得带过去。
 * 多列一起加时看最后一列 —— 那是新加的那批的末尾,能顺带把前面几列带进视野。
 */
export function columnToReveal(
  previous: readonly string[],
  next: readonly string[],
): string | null {
  if (previous.length === 0) return null;
  const added = newColumnKeys(previous, next);
  return added.at(-1) ?? null;
}
