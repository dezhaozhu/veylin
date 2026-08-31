/**
 * 生产产物的不变量:**可选依赖的"在场状态"和产物必须自洽**。
 *
 * 为什么需要这道检查(2026-08-31,在 45 上实测挖出):`dhtmlx-gantt-loader.ts`
 * 那行动态 import 曾带着 vite-ignore 注解,它在 `vite build` 里**关掉了这条
 * import 的分析** —— 包明明装好了,rollup 也不去打它,产物里留下裸说明符,
 * 浏览器当 URL 解析必然失败,loader 归类成"未安装" —— **甘特在任何生产构建
 * 里都用不了,只有 vite dev 能用,而且整整一个月没人发现**:优雅降级把故障
 * 伪装成了"没买许可"的正常状态。
 *
 * 单测和 e2e 都抓不到这一类:它们跑在 dev server 上。CI 也抓不到 —— CI 没有
 * dhtmlx 私有源凭据,包永远不在场,只会走降级那条路。**只有"跟着构建走"的
 * 检查才在包真的在场的地方(部署机、开发机)现形。**
 */

export const DHX_SPECIFIER = '@dhx/react-gantt';
/** 样式表是同一个包里的兄弟资源,和 JS 走同一条缝 —— 漏了它甘特会渲染成
 * 无样式(标签重叠到读不了,2026-08-19 评审实测过)。 */
export const DHX_CSS_SPECIFIER = '@dhx/react-gantt/dist/react-gantt.css';

export type DistChunk = { name: string; code: string };

export type DistScan = {
  /** 哪个 chunk 里留着裸说明符(= 这条 import 没被打包,external 或被屏蔽分析)。 */
  bareSpecifierIn: string | null;
  /** 样式表的裸说明符落在哪个 chunk。 */
  bareCssSpecifierIn: string | null;
  /** 哪个 chunk 是 dhtmlx 库本体。 */
  libraryChunkIn: string | null;
};

/**
 * 裸说明符的三种引号形式都要认 —— **rolldown 输出的是反引号**
 * (`import(\`@dhx/react-gantt\`)`),只按引号找会连着两轮扑空(实测)。
 */
function hasBareSpecifier(code: string, specifier: string): boolean {
  return (
    code.includes(`import("${specifier}")`) ||
    code.includes(`import('${specifier}')`) ||
    code.includes(`import(\`${specifier}\`)`)
  );
}

/**
 * 库本体的特征。**不能只看 "dhtmlx" 这个词** —— loader 自己的 console.debug
 * 串里就有 `[dhtmlx-gantt-loader]`,按词匹配会把降级日志误判成库在场。
 * 认文件名(rollup 按入口文件命名 chunk)或库内部的标识符。
 */
function isLibraryChunk(chunk: DistChunk): boolean {
  if (/dhtmlxgantt/i.test(chunk.name)) return true;
  return /gantt_task_line|dhx_gantt/.test(chunk.code);
}

export function scanDistChunks(chunks: readonly DistChunk[]): DistScan {
  return {
    bareSpecifierIn: chunks.find((c) => hasBareSpecifier(c.code, DHX_SPECIFIER))?.name ?? null,
    bareCssSpecifierIn:
      chunks.find((c) => hasBareSpecifier(c.code, DHX_CSS_SPECIFIER))?.name ?? null,
    libraryChunkIn: chunks.find(isLibraryChunk)?.name ?? null,
  };
}

export type DistVerdict = { ok: true } | { ok: false; reason: string };

export function checkDistInvariants(args: {
  /** 构建那台机器上 `@dhx/react-gantt` 解析得到吗。 */
  hasDhx: boolean;
  chunks: readonly DistChunk[];
}): DistVerdict {
  const { bareSpecifierIn, bareCssSpecifierIn, libraryChunkIn } = scanDistChunks(args.chunks);

  if (args.hasDhx) {
    if (bareCssSpecifierIn) {
      return {
        ok: false,
        reason:
          `@dhx/react-gantt 装好了,但**样式表**的裸说明符还留在产物里(${bareCssSpecifierIn})—— ` +
          `css 没被打包,甘特会渲染成无样式(标签重叠到读不了)。和 JS 那条同一个原因:` +
          `检查那行 import 上的 vite-ignore 之类注解。`,
      };
    }
    if (bareSpecifierIn) {
      return {
        ok: false,
        reason:
          `@dhx/react-gantt 装好了,产物里却留着裸说明符(${bareSpecifierIn})—— ` +
          `这条 import 没被打包,运行时会解析失败、甘特静默消失。` +
          `检查那条动态 import 上有没有 vite-ignore 之类屏蔽分析的注解,` +
          `以及 vite.config.ts 的 external 是不是把它排掉了。`,
      };
    }
    if (!libraryChunkIn) {
      return {
        ok: false,
        reason:
          '@dhx/react-gantt 装好了,但它没有被打进产物(既没有库 chunk,也没有裸说明符)。' +
          '甘特会静默消失 —— 构建把整条链摇掉了?',
      };
    }
    return { ok: true };
  }

  if (libraryChunkIn) {
    return {
      ok: false,
      reason:
        `@dhx/react-gantt 没装,产物里却有库 chunk(${libraryChunkIn})—— ` +
        '不该发生,许可上也禁止再分发。',
    };
  }
  // 缺席时:裸说明符(external 原样留着)和"整条被摇掉"都是自洽的降级形态。
  return { ok: true };
}
