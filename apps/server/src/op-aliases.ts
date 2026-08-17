/**
 * 工序名对照表:**文档里的叫法 ↔ 系统里的叫法**。
 *
 * 真数据打脸:上重 11 个文档工序名只有 2 个能一字不差对上 —— 文档说「最终验收」,
 * 系统里是「最终检验」。没有这张表,对照的产出就是一堆诚实但没用的"查不到"。
 *
 * 形状照红线提名那条走过的路:**候选 → 人确认 → 落库复用**。三条不让步的:
 *
 * 1. **只认人确认过的。** 近似名只当候选提出来,绝不自动生效 —— 自动配对一旦配错,
 *    后面所有结论都错在一个没人看过的假设上,而且看起来完全正常。
 * 2. **别名是单向的**:文档词 → 系统词。反过来用,会把系统里的真名替换成文档土话。
 * 3. **一个文档词只指一个系统词。** 指两个等于没指,而且会静默选一个。
 */
export type OpAlias = { system: string; confirmedBy: string; at: string };
export type OpAliases = Record<string, OpAlias>;

/** 文档词 → 系统词。没登记过就原样返回 —— **不猜**。 */
export function applyAliases(name: string, aliases: OpAliases): string {
  return aliases[name.trim()]?.system ?? name;
}

export type MergeResult = { aliases: OpAliases; note?: string };

/**
 * 人确认之后落一条。
 *
 * **改指向要说出来**:静默覆盖等于把之前所有基于旧别名得出的结论一次性作废,
 * 而没有任何人知道 —— 那些结论还留在对话里,看起来照旧成立。
 */
export function mergeAlias(
  aliases: OpAliases,
  input: { doc: string; system: string; by: string; at?: string },
): MergeResult {
  const doc = input.doc.trim();
  const system = input.system.trim();
  if (!doc || !system) throw new Error('文档里的叫法和系统里的叫法都要给');
  // 自己指自己不是别名,是噪音 —— 而且会让"这条登记过了"变成一句假话。
  if (doc === system) throw new Error('两个名字是同一个,不需要别名');

  const prev = aliases[doc];
  const next: OpAliases = {
    ...aliases,
    [doc]: { system, confirmedBy: input.by, at: input.at ?? new Date().toISOString() },
  };
  if (!prev) return { aliases: next };
  if (prev.system === system) {
    return { aliases: next, note: `本来就是这么对的(${doc} → ${system}),没有变化。` };
  }
  return {
    aliases: next,
    note:
      `改了指向:「${doc}」原来指向「${prev.system}」,现在改成「${system}」。` +
      '之前基于旧别名得出的结论要重新对照一遍。',
  };
}

// —— 落盘 ————————————————————————————————————————
//
// **存在项目文件夹的 `.veylin/op-aliases.json`**,和原件仓的 manifest 同一处:
// 跟着项目走(换台机器还在)、人能直接打开看和手改、也不需要另起一张表。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ALIAS_FILE = 'op-aliases.json';

export async function readAliases(folder: string): Promise<OpAliases> {
  try {
    const raw = await readFile(join(folder, '.veylin', ALIAS_FILE), 'utf8');
    const parsed = JSON.parse(raw) as { aliases?: OpAliases };
    return parsed.aliases ?? {};
  } catch {
    // 没有文件 = 还没登记过;文件坏了 = 有人手改坏了。两种都当空表 ——
    // 一个坏掉的 JSON 不该让整条对照失败(而对照失败的表现是"全部查不到")。
    return {};
  }
}

export async function writeAliases(folder: string, aliases: OpAliases): Promise<void> {
  await mkdir(join(folder, '.veylin'), { recursive: true });
  // 缩进写:这个文件是给人看和手改的。
  await writeFile(
    join(folder, '.veylin', ALIAS_FILE),
    JSON.stringify({ version: 1, aliases }, null, 2),
    'utf8',
  );
}
