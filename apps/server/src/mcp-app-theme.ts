/**
 * MCP App 的宿主侧覆盖。所有 widget 的滚动条跟对话列表对齐;
 * 甘特另外盖配色、虚线和缩放滑条。
 *
 * widget 的 HTML 经过 `routes/mcp-apps.ts` 的 `resources/read` 代理。iframe
 * 是带独立 origin 的沙箱,宿主样式表跨不进去,所以在交给前端之前往 HTML 末尾
 * 追加一段 `<style>`。选择器只绑标准属性 / `input[type=range]`,不绑它的内部
 * 类名 —— 对方改版不会把这段弄失效;失效了也只是虚线回来,图不会坏。
 */

/** 甘特 widget 的 uri 有两套写法:Compass 真机是 `ui://widget/gantt.html`,
 * 测试和个别入口会写成 `ui://compass/gantt.html` / `ui://compass/gantt`。
 * 只认前一个,真机有时能盖上、有时漏掉。其它 widget 原样透传。 */
function isGanttWidgetUri(uri: string): boolean {
  return /(?:^|\/)gantt(?:\.html)?$/.test(uri);
}

/** 注入过的标记,避免同一份 HTML 被追加两遍。 */
const THEME_MARKER = 'data-veylin-app-theme';

/**
 * 按期条用冷蓝灰。迟的两档要同风格(浅、净、低饱和)、不同色相。
 * 土黄/砖红会显旧,改成浅金和浅玫瑰,和蓝灰是同一套洗水色。
 * 密排虚线/点阵会触发密集不适,条一律实心。
 * 通配 `*{border-style}` 会给每个标签加框,不绑。
 */
const GANTT_CHROME = `:root{
  --ok:#d4e4e7;
  --warn:#e0c9a0;
  --over:#d9a9a6;
  --frozen:#b0bcc8;
  --today:#9aa7b4;
}
svg *,svg{stroke-dasharray:none!important;stroke-linecap:butt!important}
pattern{display:none!important}
[fill^="url"]{fill:var(--ok)!important}
[style*="dashed"],[style*="dasharray"]{border-style:solid!important}
/* 行高不动,只把条本身压瘦 —— 上下空出来就是间距。按每条自己的盒子中心
 * 缩放,不绑它的类名。背景大矩形没有这些 fill,不会被带着缩小。 */
[fill="var(--ok)"],[fill="var(--warn)"],[fill="var(--over)"],[fill="var(--frozen)"],
[fill="#d4e4e7"],[fill="#e0c9a0"],[fill="#d9a9a6"],[fill="#b0bcc8"],
[style*="var(--ok)"],[style*="var(--warn)"],[style*="var(--over)"],[style*="var(--frozen)"]{
  transform:scaleY(.7);
  transform-box:fill-box;
  transform-origin:center;
}
/* 缩放滑条:浏览器默认是一颗高饱和蓝点。widget 自己没给它变量,只能盖标准
 * \`input[type=range]\` —— 这是 HTML 控件,不是它的内部类名,对方改版不会
 * 把选择器弄失效。 */
input[type=range]{
  -webkit-appearance:none;
  appearance:none;
  height:4px;
  background:#e4e8ec;
  border-radius:999px;
  outline:none;
}
input[type=range]::-webkit-slider-runnable-track{
  height:4px;
  background:#e4e8ec;
  border-radius:999px;
}
input[type=range]::-webkit-slider-thumb{
  -webkit-appearance:none;
  width:12px;height:12px;
  margin-top:-4px;
  border:none;
  border-radius:50%;
  background:#5b6672;
  box-shadow:none;
}
input[type=range]::-moz-range-track{
  height:4px;
  background:#e4e8ec;
  border:none;
  border-radius:999px;
}
input[type=range]::-moz-range-thumb{
  width:12px;height:12px;
  border:none;
  border-radius:50%;
  background:#5b6672;
}`;

/**
 * 给 widget HTML 追加宿主侧覆盖。所有 uri 都盖滚动条;甘特另外盖配色。
 *
 * 追加在文档末尾:这份 HTML 是个片段(没有 html/head 标签),后出现的声明赢。
 */
/** 跟对话列表 `[data-slot=aui_thread-viewport]` 同一套:5px 圆头、无轨道。
 * 选择器只绑标准伪元素,不绑 widget 内部类名。 */
const SCROLLBAR_CHROME = `*{scrollbar-width:thin;scrollbar-color:#e4e4e8 transparent}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#e4e4e8;border-radius:9999px}
::-webkit-scrollbar-thumb:hover{background:#d4d4d8}`;

const THEME_BLOCK_RE = /<style[^>]*data-veylin-app-theme[^>]*>[\s\S]*?<\/style>/;

function themeBlock(kind: 'gantt' | 'chrome', css: string): string {
  return `<style ${THEME_MARKER}="${kind}">${css}</style>`;
}

export function themeMcpAppHtml(uri: string, html: string): string {
  const gantt = isGanttWidgetUri(uri);
  const css = gantt ? `${SCROLLBAR_CHROME}\n${GANTT_CHROME}` : SCROLLBAR_CHROME;
  const block = themeBlock(gantt ? 'gantt' : 'chrome', css);
  if (html.includes(THEME_MARKER)) return html.replace(THEME_BLOCK_RE, block);
  return `${html}\n${block}\n`;
}
