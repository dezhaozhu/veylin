import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

// @dhx/react-gantt(dhtmlx 甘特)是可选依赖 —— 私有源 + 许可禁止再分发,公开仓不带包。
// 装得到就正常打进去;装不到就把它列为 external,rollup 不去解析一个不存在的包,
// 构建照样过(运行时该功能的页签由 dhtmlx-gantt-loader.ts 静默不出现)。
const hasDhx = (() => {
  try {
    createRequire(import.meta.url).resolve('@dhx/react-gantt');
    return true;
  } catch {
    return false;
  }
})();

/**
 * `vite dev` 施工点(2026-08-19,评审后实测挖出):`build.rollupOptions.external`
 * 只管 `vite build`(Rollup)。dev server 走的是完全不同的一条路——浏览器发起
 * 一个动态 import('@dhx/react-gantt'),Vite 的 import-analysis 插件在**转译
 * 这个源文件的时候**(不是运行的时候)就会去 resolve('@dhx/react-gantt'),
 * 包缺席就直接对这次转译请求回 500,而且这个 500 会把发起它的那条动态 import
 * 链一路拖垮到 AssistantChat.tsx,变成全屏错误边界——不是"这个面板打不开",
 * 是整个应用在 `vite dev` 里打不开。"忽略这次分析"的注释只压"Vite 静态分析
 * 器读不出目标是什么"那一类动态 import 的一句警告,对参数是字面量字符串的
 * 这次 resolve 完全不生效(实测过,见 dhtmlx-gantt-loader.ts 的注释)。
 *
 * 把说明符从字面量挪成变量能让 Vite 放弃静态解析,但那样浏览器收到的是一个
 * 裸包名(@dhx/react-gantt)本身——Vite 平时正是靠"看得到字面量说明符"才能
 * 把它重写成 /node_modules/.vite/deps/... 这种浏览器能直接 fetch 的 URL;
 * 放弃静态解析等于两头都不对:包在场时也解析不出来了(已实测复现,是这条修
 * 法的一次真回归,不是假设)。
 *
 * 真正对的做法是让 resolve 这一步本身在包缺席时**成功**,把"包不存在"这件
 * 事挪到求值阶段——只在 dev server(apply: 'serve',不碰 `vite build` 已经
 * 在用的 external 那条路)、只在包真的不在场时,把 @dhx/react-gantt 解析到
 * 一个虚拟桩模块;桩模块的代码在被求值时抛出一个 `code: 'ERR_MODULE_NOT_FOUND'`
 * 的错误,让 dhtmlx-gantt-loader.ts 里已经写好的 try/catch 原样接住它——和
 * 包真的不存在时 Node/浏览器抛出的错误走同一条分类分支,不需要改动 loader
 * 本身一行代码。
 */
const DHX_STUB_ID = '\0virtual:dhx-react-gantt-stub';
// react-gantt.css(2026-08-19,评审后追加):dhtmlx-gantt-loader.ts's
// loadDhtmlxGanttCss() dynamically imports this sibling stylesheet — it's a
// SEPARATE literal specifier from the bare package id above, so it needs its
// OWN stub entry here. Same failure mode as the JS module (see the long
// comment below): Vite's dev transform speculatively resolves every literal
// dynamic-import string in a file at transpile time, independent of whether
// the call is actually reached at runtime, so gating the call site on
// "package already confirmed present" doesn't exempt this path from needing
// a stub too.
const DHX_CSS_ID = '@dhx/react-gantt/dist/react-gantt.css';
const DHX_CSS_STUB_ID = '\0virtual:dhx-react-gantt-css-stub';
function dhxDevStubPlugin(): Plugin {
  return {
    name: 'dhx-gantt-dev-stub',
    apply: 'serve',
    resolveId(id) {
      if (hasDhx) return null;
      if (id === '@dhx/react-gantt') return DHX_STUB_ID;
      if (id === DHX_CSS_ID) return DHX_CSS_STUB_ID;
      return null;
    },
    load(id) {
      if (id !== DHX_STUB_ID && id !== DHX_CSS_STUB_ID) return null;
      return [
        "const e = new Error(\"Cannot find package '@dhx/react-gantt'\");",
        "e.code = 'ERR_MODULE_NOT_FOUND';",
        'throw e;',
      ].join('\n');
    },
  };
}

// @caliper/viewer 真包通过 node_modules 软链接入(ln -s <caliper>/packages/viewer
// node_modules/@caliper/viewer);存在则打真 3D 查看器,否则落 shim 兜底。
const caliperViewerReal = fileURLToPath(
  new URL('../../node_modules/@caliper/viewer/dist/index.js', import.meta.url),
);
const caliperViewer = existsSync(caliperViewerReal)
  ? caliperViewerReal
  : fileURLToPath(new URL('./src/shims/caliper-viewer.tsx', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss(), dhxDevStubPlugin()],
  resolve: {
    // Ensure a single React copy so AG-Grid's hooks share the app's
    // React instance (otherwise: "Invalid hook call / more than one copy").
    dedupe: ['react', 'react-dom', 'three'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@/vendor/assistant-ui': fileURLToPath(
        new URL('./src/vendor/assistant-ui/index.ts', import.meta.url),
      ),
      'secure-json-parse': fileURLToPath(
        new URL('./src/shims/secure-json-parse.ts', import.meta.url),
      ),
      '@caliper/viewer': caliperViewer,
    },
  },
  optimizeDeps: {
    include: ['assistant-stream'],
  },
  build: {
    // Keep esbuild for CSS minification (safe override, harmless here).
    cssMinify: 'esbuild',
    rollupOptions: {
      // Rollup's `external` matches exact strings, not prefixes — the CSS
      // subpath (loadDhtmlxGanttCss's dynamic import) needs its own entry,
      // it isn't covered by the bare package id above.
      external: hasDhx ? [] : ['@dhx/react-gantt', DHX_CSS_ID],
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/health': {
        target: process.env.E2E_API_URL ?? process.env.VITE_API_URL ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/api': {
        target: process.env.E2E_API_URL ?? process.env.VITE_API_URL ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
