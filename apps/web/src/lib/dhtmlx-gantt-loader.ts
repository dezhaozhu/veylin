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

// **`vite dev` 施工点(2026-08-19,评审后实测挖出;完整推理见 vite.config.ts
// 里 `dhxDevStubPlugin` 的注释)**:包缺席时,`import('@dhx/react-gantt')` 在
// `vite dev` 下会在**转译这个文件的时候**(不是运行的时候)让 Vite 尝试
// resolve 这个说明符,失败就对这次转译请求整体回 500,把发起它的那条动态
// import 链一路拖垮到 AssistantChat.tsx,变成全屏错误边界。`/* @vite-ignore */`
// 对这种"参数是字面量字符串"的 resolve 不生效(只压"读不出目标是什么"那一
// 类的警告)。修法不在这个文件里:`vite.config.ts` 的 `dhxDevStubPlugin` 在
// dev server 里让这次 resolve 本身成功(解析到一个虚拟桩模块),桩模块求值
// 时抛出一个 `code: 'ERR_MODULE_NOT_FOUND'` 的错误——下面这段 try/catch 原样
// 接住它,和包真的不存在时走同一条分类分支,这个文件不需要知道任何 dev-only 细节。
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

let cssLoaded = false;

/**
 * The stylesheet is a sibling asset in the same optional package
 * (`dist/react-gantt.css`) — the JS module alone renders unstyled (labels
 * overlap into unreadable text; 评审实测 2026-08-19). Nobody in this repo
 * imported it, so this was a real bug, not a hypothetical one.
 *
 * Callers must only invoke this AFTER `loadDhtmlxGantt()` has already
 * resolved the JS module successfully (gantt-panel.tsx does this) — that's
 * what makes it safe to skip the same dev-server construction
 * `loadDhtmlxGantt` needs: a literal dynamic `import()` of a package
 * subpath is *speculatively* resolved by Vite's dev transform the moment
 * this file is transpiled, regardless of whether the call below actually
 * runs (see vite.config.ts's `dhxDevStubPlugin`, which stubs both the JS
 * package id and this CSS path). Gating the *call site* on "JS already
 * loaded" doesn't change that static-resolution risk, so the stub still has
 * to cover this path too — but it does mean this function is only ever
 * reached at runtime when the package is genuinely present.
 *
 * Best-effort: a missing/failed stylesheet degrades to unstyled bars, not a
 * broken panel — never throws, callers fire-and-forget it (`void`).
 */
export async function loadDhtmlxGanttCss(
  opts: { importer?: () => Promise<unknown> } = {},
): Promise<boolean> {
  if (cssLoaded && !opts.importer) return true;
  const importer =
    opts.importer ?? (() => import(/* @vite-ignore */ '@dhx/react-gantt/dist/react-gantt.css'));
  try {
    await importer();
    if (!opts.importer) cssLoaded = true;
    return true;
  } catch (err) {
    console.debug('[dhtmlx-gantt-loader] react-gantt.css 加载失败,甘特会照常渲染但没有样式:', err);
    return false;
  }
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

/** TEST-ONLY, same reasoning as `__setCachedForTests` — `loadDhtmlxGanttCss`'s
 * cache-write is also a no-op when a custom `importer` is passed, so a test
 * exercising "already loaded, return true without calling importer again"
 * needs a direct way to seed that state. */
export function __setCssLoadedForTests(value: boolean): void {
  cssLoaded = value;
}
