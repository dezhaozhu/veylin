/**
 * 上下文那一栏从"一行一行的清单"改成**卡片**(形状取自 Claude 的 Context 栏)。
 *
 * 为什么值得改:清单把三类东西(原件/快照/文件夹里的/生成的)拉成一样长的一行,
 * 名字被挤成一截,类型只能靠后缀猜。卡片给名字两行、把类型做成角标、PDF 直接
 * 出封面 —— 人是**认出**文件,不是读一列文本。
 *
 * **文件夹里的文件:少就一张张摆,多才折叠成一张文件夹卡。**
 * 折叠是为了不让"需要时才去看"的一堆文件淹掉真正留了档的东西;可一旦无脑折叠,
 * 三五个文件的项目就只剩一个文件夹图标 —— 类型、封面、大小全没了,而 PDF 封面
 * 这类东西恰恰只在一张张摆的时候才有意义(否则那段代码等于白写)。
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

const WHERE_ALL = { folder: '文件夹里', generated: '生成的', draft: '文稿' } as const;

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

/** 文件夹里超过这么多份才折叠 —— 少的时候一张张摆更有用。 */
export const FOLDER_FOLD_FROM = 5;

export function toContextCards(data: ContextData): ContextCard[] {
  const cards: ContextCard[] = [];

  const inFolder = (data.files ?? []).filter((f) => f.where === 'folder');
  const foldFolder = inFolder.length >= FOLDER_FOLD_FROM;
  if (data.folder && foldFolder) {
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
    if (f.where === 'folder' && foldFolder) continue; // 已经并进那张文件夹卡了
    cards.push({
      kind: 'file', key: `f-${f.name}`, name: f.name, badge: badgeOf(f.name),
      meta: `${WHERE_ALL[f.where]} · ${humanBytes(f.bytes)}`, cover: /\.pdf$/i.test(f.name),
    });
  }
  return cards;
}
