/**
 * 上下文那一栏从"一行一行的清单"改成**卡片**(形状取自 Claude 的 Context 栏)。
 *
 * 为什么值得改:清单把三类东西(原件/快照/文件夹里的/生成的)拉成一样长的一行,
 * 名字被挤成一截,类型只能靠后缀猜。卡片给名字两行、把类型做成角标、PDF 直接
 * 出封面 —— 人是**认出**文件,不是读一列文本。
 *
 * **文件夹合成一张卡**(和参考一致):文件夹里躺着多少份就写多少项,点开进面板。
 * 它们本来就是"需要时才去看"的那一类,一份一张卡会把真正留了档的东西淹掉。
 */
export type ContextCard =
  | { kind: 'folder'; key: string; name: string; count: number }
  | {
      kind: 'file';
      key: string;
      name: string;
      /** 右下角那个类型角标,取扩展名;没有扩展名就不给角标。 */
      badge: string | null;
      /** 名字下面那行:来处 · 大小 */
      meta: string;
      /** PDF 才有封面 —— 别的类型强行截图既慢又难认。 */
      cover: boolean;
    };

type ContextData = {
  folder: string | null;
  originals: Array<{ name: string; bytes: number; seenCount: number }>;
  snapshots: Array<{ name: string; bytes: number }>;
  files?: Array<{ name: string; bytes: number; where: 'folder' | 'generated' | 'draft' }>;
};

const WHERE = { generated: '生成的', draft: '文稿' } as const;

export const humanBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export function badgeOf(name: string): string | null {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1];
  return ext ? ext.toUpperCase() : null;
}

/** 文件夹卡上显示的名字:路径太长了,只留最后一段。 */
export function folderLabel(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function toContextCards(data: ContextData): ContextCard[] {
  const cards: ContextCard[] = [];

  const inFolder = (data.files ?? []).filter((f) => f.where === 'folder');
  if (data.folder && inFolder.length > 0) {
    cards.push({
      kind: 'folder',
      key: 'folder',
      name: folderLabel(data.folder),
      count: inFolder.length,
    });
  }

  for (const f of data.originals) {
    cards.push({
      kind: 'file', key: `o-${f.name}`, name: f.name, badge: badgeOf(f.name),
      meta: `原件 · ${humanBytes(f.bytes)}${f.seenCount > 1 ? ` · 用过 ${f.seenCount} 次` : ''}`,
      cover: /\.pdf$/i.test(f.name),
    });
  }
  for (const f of data.snapshots) {
    cards.push({
      kind: 'file', key: `s-${f.name}`, name: f.name, badge: badgeOf(f.name),
      meta: `快照 · ${humanBytes(f.bytes)}`, cover: /\.pdf$/i.test(f.name),
    });
  }
  for (const f of data.files ?? []) {
    if (f.where === 'folder') continue; // 已经并进那张文件夹卡了
    cards.push({
      kind: 'file', key: `f-${f.name}`, name: f.name, badge: badgeOf(f.name),
      meta: `${WHERE[f.where]} · ${humanBytes(f.bytes)}`, cover: /\.pdf$/i.test(f.name),
    });
  }
  return cards;
}
