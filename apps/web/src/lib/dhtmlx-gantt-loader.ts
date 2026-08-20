/**
 * dhtmlx 甘特是**可选**依赖:包在私有源(npm.dhtmlx.com),许可禁止再分发,所以它
 * 不在这个公开仓里。装得到 → 甘特页签出现;装不到 → 页签不出现(不是报错)。
 *
 * 与 AG-Grid Enterprise 那条缝同形(ag-grid-license.ts):没授权的构建里,连相关
 * 代码都不该被打进去。
 */
export type GanttModule = Record<string, unknown>;

let cached: GanttModule | null | undefined;

/**
 * 区分"包没装"(私有源没凭据,正常状态)和"包装了但加载/初始化炸了"(真故障,比如
 * 版本不兼容、导出名对不上)——两种在用户侧都是"页签不出现",但排查时得分得清,
 * 不能都归成一句"加载失败"。只落 console.debug,不改变返回值、不抛。
 */
function isModuleNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return true;
  const message = (err as { message?: unknown }).message;
  return (
    typeof message === 'string' &&
    /cannot find (package|module)|failed to resolve (import|module)|does not provide an export/i.test(
      message,
    )
  );
}

export async function loadDhtmlxGantt(
  opts: { importer?: () => Promise<unknown> } = {},
): Promise<GanttModule | null> {
  if (cached !== undefined && !opts.importer) return cached;
  const importer = opts.importer ?? (() => import(/* @vite-ignore */ '@dhx/react-gantt'));
  try {
    const mod = (await importer()) as GanttModule;
    if (!opts.importer) cached = mod;
    return mod;
  } catch (err) {
    if (!opts.importer) cached = null;
    if (isModuleNotFoundError(err)) {
      console.debug(
        '[dhtmlx-gantt-loader] @dhx/react-gantt 未安装 —— 私有源没凭据是正常状态,甘特页签不出现。',
      );
    } else {
      console.debug(
        '[dhtmlx-gantt-loader] @dhx/react-gantt 已安装但加载/初始化失败(可能是版本不兼容),' +
          '甘特页签仍不出现:',
        err,
      );
    }
    return null;
  }
}

/** Synchronous check for whether the module has already resolved successfully. */
export function isDhtmlxAvailable(): boolean {
  return cached != null;
}

/**
 * TEST-ONLY. 生产代码不许调用。
 *
 * 为什么需要它:`loadDhtmlxGantt` 传自定义 importer 时,对模块级缓存读写都是零
 * 副作用(见上面两处 `if (!opts.importer)` 守卫)——这是刻意的生产契约,不能为了
 * "方便测试"就削弱。但这样一来,`isDhtmlxAvailable()` 的"未加载/加载成功/加载
 * 失败"三态就没法只靠 `loadDhtmlxGantt({ importer })` 驱动出来了(它压根碰不到
 * `cached`)。所以直接给测试一个显式出口去摆放三态里的每一态,不依赖任何调用顺序、
 * 也不必去真的装/卸包。
 */
export function __setCachedForTests(value: GanttModule | null | undefined): void {
  cached = value;
}
