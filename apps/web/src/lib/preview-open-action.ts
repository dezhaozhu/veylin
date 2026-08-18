/**
 * 预览里那个"在右侧打开"该给什么。
 *
 * 中间能预览、右侧却打不开,是因为"打开"从前只有一种意思(文档面板)。可**不同
 * 类型该去的地方不一样**,而且对表格来说,预览只是概览(前几行)——真正能筛选、
 * 统计、被 table_query 用的形态是表格面板里那张表。用户原话:能不能预览完直接
 * 选右侧打开。
 *
 * agent 侧早就有 table_import_file 这条路,人却没有 —— 这个不对称本身就是缺口。
 */
export type PreviewOpenTarget = 'table' | 'doc' | null;

const SPREADSHEET = /\.(xlsx|xlsm|xls|csv)$/i;
const DOCUMENT = /\.(docx|doc|pdf|pptx|ppt|md|txt)$/i;

export function previewOpenTarget(name: string): PreviewOpenTarget {
  if (SPREADSHEET.test(name)) return 'table';
  if (DOCUMENT.test(name)) return 'doc';
  return null;
}

/** 导进来的表叫什么:用文件名(去掉后缀);重名就加序号,别覆盖已有的表。 */
export function newSheetName(fileName: string, existing: readonly string[]): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || '导入';
  if (!existing.includes(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base} ${i}`;
    if (!existing.includes(candidate)) return candidate;
  }
}
