/**
 * MCP App 的宿主侧覆盖。所有 widget 统一滚动条(跟对话列表对齐)和正文观感;
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

/** 场景认知卡 —— 只有它是五节折叠的文档型结构,见 CARD_CHROME。 */
function isSceneCardWidgetUri(uri: string): boolean {
  return /(?:^|\/)scene-card(?:\.html)?$/.test(uri);
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

/**
 * 文字和分隔物。资源负荷那种表格 widget 一屏 179 行,每行都带一条实线、一个
 * 灰底空条、一个半粗体名字 —— 单看都不重,叠 179 遍就成了一片脏。这里做的全是
 * 减法:把"每行都有"的东西压到看得见但不抢眼,省下的对比度留给真正有差别的格子。
 *
 * 只动变量和元素选择器。`font-weight` 要 `!important` 是因为名称列的 500 挂在
 * 它自己的类上,类赢元素 —— 但绑类名就会在对方改版时失效,宁可用 `!important`。
 * `<b>` 的粗体来自 UA 样式表,不受这条影响,K 值该重的地方还是重的。
 *
 * 颜色收在 `prefers-color-scheme: light` 里:这些 widget 自己带暗色块,而这段排在
 * 它后面、同样是 `:root`,不限定就会把亮色行线盖到暗色背景上。`light` 在"无偏好"
 * 时也命中,所以亮色下照常生效。字重跟明暗无关,留在外面。
 *
 * 改不动的是文案本身:双语标题、`monthly_weight (吨/月, 历史推断)` 这种拿字段名
 * 当说明、`K 8` 的缩写 —— 都是 widget 脚本里的字符串,得在 Compass 侧改。
 */
const TEXT_CHROME = `td{font-weight:400!important}
@media (prefers-color-scheme: light){
  :root{
    --line:#f0f1f4;
    --muted:#8b93a1;
    --bar-bg:#f6f7f9;
    --set:#7fa08a;
    --inferred:#c9a97a;
    --drum:#c9a97a;
  }
}`;

/**
 * 场景认知卡:五个等重的边框盒 → 发丝分隔线。
 *
 * 这张卡把五节(问题结构/产能口径/红线/数据诚实度/规则健康)各自套一个 1px 圆角
 * 盒,再整体放进面板的盒里 —— 盒中盒,且五节等重。视线没有落点,这是"看着乱"的
 * 主要来源,比配色要紧。
 *
 * 分隔改用顶边发丝线:节与节之间仍然分得开,但不再每节都是一个独立容器。
 * `border` 是简写,只写 `border-top` 会被它自己的 `border: 1px solid` 盖回来,
 * 所以先清零再给顶边。`!important` 是必需的 —— 它的 `.sec`(0,1,0)赢过元素
 * 选择器 `details`(0,0,1),而绑类名会在对方改版时静默失效。
 *
 * 只绑 `details`:这张卡里 `.sec` 和 `.narrative` 都是 details,一起收掉,风格
 * 统一。`.sec .detail` 里那条分隔摘要与展开内容的线是类选择器,不受影响,留着
 * 正好当小标题下的横线。
 *
 * **「这里不对?」按钮**(第二条规则):它的容器是 `text-align:right`,铺满面板时
 * 这颗按钮离它指的正文能有上千像素 —— 点得到,但对不上是在纠正哪一段;五节各有
 * 一颗在右边排成一列,更像装饰。这里改的是**位置**,不是把它藏掉:它是能用的功能
 * (向宿主发起纠正提案),悄悄隐藏一个在工作的入口比位置不对更糟。"五处收成一处"
 * 要判断哪一节该留,那是结构问题,归 widget 自己。
 *
 * 从按钮自身翻身、不碰容器 —— 容器只有类名可绑。`display:block` 加
 * `margin-right:auto` 让它脱离父级的 text-align,`width:fit-content` 保证点击区
 * 不横跨整行。
 *
 * **字号三档**(第三组规则):正文区原本 6 档 —— 14 / 13.5 / 13 / 12.5 / 11.5 / 11,
 * 相邻只差 0.5px,合起来既读不出层级、又不像刻意的梯度。更糟的是有处倒挂:
 * `.subhead` 是 11.5px 的小标题,比它领的 12.5px 正文还小。
 *
 * 真正缺的信号在这三者:节标题 `.label`、一行摘要 `.line`、展开正文 `.detail`
 * 原本**全是 12.5px**,所以扫一眼分不出谁是标题谁是内容。现在拉开成
 * 13(节标题,自带 600 字重)/ 12.5(正文)/ 11.5(摘要行与元信息),摘要行同时
 * 保留它原有的 muted 色 —— 尺寸和明度一起降,才读得出它从属于旁边的标题。
 * 卡标题 `h1` 的 14px 不动,它比节标题高一级是对的。
 *
 * 这一组**绑了 widget 的类名**,是这个文件里的例外(其余都只绑标准属性)。
 * 换来的是唯一能做层级的杠杆:字号只存在于 `.label` / `.line` / `.detail` 这些类上,
 * 没有等价的元素选择器。代价可接受 —— 对方改类名只会让这组静默失效、退回今天的
 * 样子,和甘特那段"失效了只是虚线回来"同一个道理。
 *
 * `svg.chart` 里的 11 / 10.5px 一概不动:那些坐标是 widget 的 JS 按当前字号算好的,
 * 放大标签会压到条上去。
 *
 * 说明一律写在这里、不写进 CSS 串:注释会原样发给客户端,而且模板字符串里的
 * 反引号会把串提前闭合。
 */
const CARD_CHROME = `details{
  border:none!important;
  border-radius:0!important;
  border-top:1px solid var(--line)!important;
}
details button{
  display:block;
  width:fit-content;
  margin-right:auto;
}
.sec .label{font-size:13px!important}
.sec .detail{font-size:12.5px!important}
.headline{font-size:12.5px!important}
.subhead{font-size:12.5px!important}
.narrative .ntext{font-size:12.5px!important}
.sec .line{font-size:11.5px!important}
.sec summary::before{font-size:11.5px!important}
.narrative .nlabel{font-size:11.5px!important}
.item .lv{font-size:11.5px!important}
.fixbtn{font-size:11.5px!important}`;

const THEME_BLOCK_RE = /<style[^>]*data-veylin-app-theme[^>]*>[\s\S]*?<\/style>/;

function themeBlock(kind: 'gantt' | 'card' | 'chrome', css: string): string {
  return `<style ${THEME_MARKER}="${kind}">${css}</style>`;
}

export function themeMcpAppHtml(uri: string, html: string): string {
  const gantt = isGanttWidgetUri(uri);
  const card = isSceneCardWidgetUri(uri);
  let css = `${SCROLLBAR_CHROME}\n${TEXT_CHROME}`;
  if (gantt) css += `\n${GANTT_CHROME}`;
  if (card) css += `\n${CARD_CHROME}`;
  const block = themeBlock(gantt ? 'gantt' : card ? 'card' : 'chrome', css);
  if (html.includes(THEME_MARKER)) return html.replace(THEME_BLOCK_RE, block);
  return `${html}\n${block}\n`;
}
