/**
 * 文档改完之后,人看到的那一块。
 *
 * **改已经发生了。** 按定下的治理模型(版本 + 回退当安全网,不是每一步设闸),
 * 界面要做的不是问"要不要改",而是**让人一眼看见改了什么,并且一键退得回去**。
 * 措辞必须同时说清三件事:改了哪一版、**原件没动**、能撤销 —— 少说中间那件,
 * 人会以为我们动了他那份 docx。
 */
export type DiffLine = { kind: 'add' | 'del' | 'ctx'; text: string };

export function diffLines(diff: string | undefined): DiffLine[] {
  if (!diff) return [];
  return diff.split('\n').map((l) => {
    // 没有前缀的当上下文 —— 标成新增比不标更误导。
    if (l.startsWith('+ ') || l.startsWith('+')) return { kind: 'add' as const, text: l.replace(/^\+\s?/, '') };
    if (l.startsWith('- ') || l.startsWith('-')) return { kind: 'del' as const, text: l.replace(/^-\s?/, '') };
    return { kind: 'ctx' as const, text: l.trim() };
  });
}

/**
 * 撤销退到哪一版。**第 1 版没得退** —— 那是副本刚建立的那一版,
 * 退回去等于回到"什么都没有"。
 */
export function undoTarget(revision: number): number | null {
  return revision > 1 ? revision - 1 : null;
}

export function describeEdit(r: { copy: string; revision: number; created?: boolean }): string {
  const head = r.created
    ? `已从原件新建了可改的副本 ${r.copy}`
    : `已改 ${r.copy}`;
  return `${head} · 第 ${r.revision} 版 · 原件没有改动`;
}
