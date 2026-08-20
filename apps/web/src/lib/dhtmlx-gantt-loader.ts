/**
 * dhtmlx 甘特是**可选**依赖:包在私有源(npm.dhtmlx.com),许可禁止再分发,所以它
 * 不在这个公开仓里。装得到 → 甘特页签出现;装不到 → 页签不出现(不是报错)。
 *
 * 与 AG-Grid Enterprise 那条缝同形(ag-grid-license.ts):没授权的构建里,连相关
 * 代码都不该被打进去。
 */
export type GanttModule = Record<string, unknown>;

let cached: GanttModule | null | undefined;

export async function loadDhtmlxGantt(
  opts: { importer?: () => Promise<unknown> } = {},
): Promise<GanttModule | null> {
  if (cached !== undefined && !opts.importer) return cached;
  const importer = opts.importer ?? (() => import(/* @vite-ignore */ '@dhx/react-gantt'));
  try {
    const mod = (await importer()) as GanttModule;
    if (!opts.importer) cached = mod;
    return mod;
  } catch {
    if (!opts.importer) cached = null;
    return null;
  }
}

/** Synchronous check for whether the module has already resolved successfully. */
export function isDhtmlxAvailable(): boolean {
  return cached != null;
}
