import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { themeMcpAppHtml } from './mcp-app-theme.js';

const GANTT = 'ui://widget/gantt.html';

describe('themeMcpAppHtml', () => {
  it('按期条用蓝灰,不要灰绿也不要亮绿', () => {
    const html = '<style>:root{--ok:#2e7d32}</style><div id="root"></div>';
    const out = themeMcpAppHtml(GANTT, html);
    assert.ok(out.includes('--ok:#d4e4e7'), '没改成蓝灰');
    assert.ok(out.indexOf('#d4e4e7') > out.indexOf('#2e7d32'), '蓝灰没盖在亮绿后面');
    assert.ok(!out.includes('--ok:#8ca896') && !out.includes('--ok:#4a6754'));
    assert.ok(!out.includes('--ok:#e2eef0') && !out.includes('--ok:#c5d9de'), '还停在两端的浅色或深色');
    assert.ok(out.includes('<div id="root"></div>'), '原文档被改坏了');
  });

  it('迟的两档同风格不同色相,不要并进蓝灰', () => {
    const out = themeMcpAppHtml(GANTT, '<svg></svg>');
    assert.ok(out.includes('--warn:#e0c9a0'), '迟≤7天不是浅金');
    assert.ok(out.includes('--over:#d9a9a6'), '迟>7天不是浅玫瑰');
    assert.ok(!out.includes('--warn:#c9a87a') && !out.includes('--over:#c48982'));
    assert.ok(!out.includes('--warn:#dfa040') && !out.includes('--over:#c25149'));
  });

  it('已经注入过的旧色要换掉,不能因为有标记就原样放过', () => {
    const stale = '<div></div>\n<style data-veylin-app-theme="gantt">:root{--ok:#8ca896}</style>\n';
    const out = themeMcpAppHtml(GANTT, stale);
    assert.ok(out.includes('--ok:#d4e4e7'), '旧灰绿没换掉');
    assert.ok(!out.includes('#8ca896'));
    assert.equal(out.split('data-veylin-app-theme').length - 1, 1, '标记变成两份了');
  });

  /** 负荷条的红黄绿是告警语义(>85% 红),不是装饰 —— 不许跟着甘特洗淡。 */
  it('别的 widget 不改编配色', () => {
    const html = '<style>:root{--ok:#2e7d32}</style>';
    const cockpit = themeMcpAppHtml('ui://widget/cockpit.html', html);
    const card = themeMcpAppHtml('ui://widget/scene-card.html', html);
    assert.ok(cockpit.includes('scrollbar-width:thin'), '驾驶舱没盖滚动条');
    assert.ok(card.includes('scrollbar-width:thin'), '场景卡没盖滚动条');
    assert.ok(!cockpit.includes('--ok:#d4e4e7') && !card.includes('--ok:#d4e4e7'));
    assert.ok(cockpit.includes('--ok:#2e7d32') && card.includes('--ok:#2e7d32'));
  });

  it('滚动条跟对话列表一样是细条、无轨', () => {
    const out = themeMcpAppHtml('ui://widget/scene-card.html', '<div></div>');
    assert.ok(out.includes('::-webkit-scrollbar{width:5px'), '不是 5px 细条');
    assert.ok(out.includes('scrollbar-color:#e4e4e8 transparent'), '拇指颜色不对');
    assert.ok(out.includes('::-webkit-scrollbar-track{background:transparent}'), '还留着轨道');
  });

  /** 一屏 179 行,"每行都有"的东西必须让路:横线、空条底色、半粗体名字。 */
  it('表格 widget 的每行装饰都压到不抢眼', () => {
    const out = themeMcpAppHtml('ui://widget/resource-load.html', '<table></table>');
    assert.ok(out.includes('--line:#f0f1f4'), '行线还是原来那么重');
    assert.ok(out.includes('--bar-bg:#f6f7f9'), '空条底色还是原来那么重');
    assert.ok(out.includes('td{font-weight:400!important}'), '名称列还是半粗体');
  });

  /** 来源圆点原来是暗金和饱和深绿,和洗过的条摆一起显旧。 */
  it('来源圆点洗淡,跟条同一套色', () => {
    const out = themeMcpAppHtml('ui://widget/resource-load.html', '<table></table>');
    assert.ok(out.includes('--set:#7fa08a') && out.includes('--inferred:#c9a97a'));
    assert.ok(!out.includes('#b8860b'), '还留着暗金');
  });

  /** widget 自己带暗色块,排在这段前面 —— 不限定亮色就会把亮色行线盖到暗背景上。 */
  it('正文配色只在亮色下生效,字重不分明暗', () => {
    const out = themeMcpAppHtml('ui://widget/resource-load.html', '<table></table>');
    const vars = out.indexOf('--line:#f0f1f4');
    const media = out.indexOf('@media (prefers-color-scheme: light)');
    assert.ok(media >= 0 && media < vars, '颜色没收进亮色查询');
    assert.ok(out.indexOf('td{font-weight:400!important}') < media, '字重被关进亮色查询了');
  });

  /** 宿主不替 widget 决定版心 —— 它的图表是写死像素、没有 viewBox 的,限宽只会
   *  让卡片被晾在宽面板左边,右侧空一大片。宽度归 widget 自己管。 */
  it('不给任何 widget 限宽', () => {
    for (const uri of [GANTT, 'ui://widget/scene-card.html', 'ui://widget/resource-load.html']) {
      assert.ok(!themeMcpAppHtml(uri, '<div></div>').includes('max-width'), uri);
    }
  });

  /** 盒中盒、且五节等重 —— 视线没有落点。换成发丝线,分得开但不再各自成容器。 */
  it('场景认知卡的边框盒换成分隔线', () => {
    const out = themeMcpAppHtml('ui://widget/scene-card.html', '<details></details>');
    assert.ok(out.includes('border:none!important'), '边框没去掉');
    assert.ok(out.includes('border-top:1px solid var(--line)!important'), '没留分隔线');
    // 简写在前、顶边在后,否则 border 会把 border-top 冲掉。
    assert.ok(out.indexOf('border:none') < out.indexOf('border-top:1px'));
    assert.ok(themeMcpAppHtml('ui://compass/scene-card', '<div></div>').includes('border:none!important'));
  });

  /** 铺满时那颗按钮离它指的正文上千像素。改位置,不是藏掉 —— 它是能用的功能。 */
  it('纠正按钮回到内容下方左侧,而不是被隐藏', () => {
    const out = themeMcpAppHtml('ui://widget/scene-card.html', '<details><button/></details>');
    assert.ok(out.includes('margin-right:auto'), '没从父级的右对齐里翻身');
    assert.ok(out.includes('width:fit-content'), '点击区会横跨整行');
    assert.ok(!/details button\{[^}]*display:none/.test(out), '把能用的入口藏掉了');
  });

  /** 节标题 / 摘要行 / 展开正文原本全是 12.5px —— 扫一眼分不出谁是标题谁是内容。 */
  it('场景认知卡的字号收成三档,三者拉开', () => {
    const out = themeMcpAppHtml('ui://widget/scene-card.html', '<div class="sec"></div>');
    assert.ok(out.includes('.sec .label{font-size:13px'), '节标题没抬起来');
    assert.ok(out.includes('.sec .detail{font-size:12.5px'), '正文档没钉住');
    assert.ok(out.includes('.sec .line{font-size:11.5px'), '摘要行没压下去');
  });

  /** 小标题原本 11.5px,比它领的 12.5px 正文还小 —— 倒挂。 */
  it('小标题不再小于它领的正文', () => {
    const out = themeMcpAppHtml('ui://widget/scene-card.html', '<div></div>');
    assert.ok(out.includes('.subhead{font-size:12.5px'), '倒挂还在');
    assert.ok(!/\.subhead\{font-size:11(\.5)?px/.test(out));
  });

  /** 只许 13 / 12.5 / 11.5 三档 —— 再冒出第四个值就是梯度又散了。
   *  h1 的 14px 是卡标题,比节标题高一级,本来就不在这三档里、也没被改。 */
  it('正文区不许出现第四个字号', () => {
    const out = themeMcpAppHtml('ui://widget/scene-card.html', '<div></div>');
    const card = out.slice(out.indexOf('.sec .label'));
    const sizes = new Set([...card.matchAll(/font-size:([\d.]+)px/g)].map((m) => m[1]));
    assert.deepEqual([...sizes].sort(), ['11.5', '12.5', '13']);
    assert.ok(!card.includes('font-size:13.5px'), '13.5px 那档没收掉');
  });

  /** 图表里的坐标是 widget 的 JS 按当前字号算好的,放大标签会压到条上。 */
  it('不碰图表内部的文字', () => {
    const out = themeMcpAppHtml('ui://widget/scene-card.html', '<svg class="chart"></svg>');
    assert.ok(!out.includes('svg.chart'), '动了图表里的字号');
  });

  /** 字号那组绑了它的类名,是这个文件里的例外 —— 别顺手泄到其它 widget 上。 */
  it('字号三档只作用于这张卡', () => {
    for (const uri of [GANTT, 'ui://widget/resource-load.html', 'ui://widget/cockpit.html']) {
      const out = themeMcpAppHtml(uri, '<div class="sec"></div>');
      assert.ok(!out.includes('.sec .label'), uri);
      assert.ok(!out.includes('.subhead'), uri);
    }
  });

  /** 这条只认这张卡 —— 别的 widget 的边框各有各的用处,不顺手收。
   *  注意别拿裸 `border:none` 当判据:甘特滑条本来就要靠它去掉浏览器默认拇指边框。 */
  it('别的 widget 边框不动', () => {
    for (const uri of [GANTT, 'ui://widget/resource-load.html', 'ui://widget/cockpit.html']) {
      const out = themeMcpAppHtml(uri, '<div></div>');
      assert.ok(!out.includes('border:none!important'), uri);
      assert.ok(!out.includes('border-top:1px solid var(--line)'), uri);
    }
  });

  /** 正文那套是所有 widget 共用的,甘特也得有。 */
  it('甘特同时拿到正文和配色两套', () => {
    const out = themeMcpAppHtml(GANTT, '<svg></svg>');
    assert.ok(out.includes('--muted:#8b93a1'), '甘特漏了正文那套');
    assert.ok(out.includes('--ok:#d4e4e7'), '甘特漏了配色');
  });

  it('重复调用不会追加两遍', () => {
    const once = themeMcpAppHtml(GANTT, '<div id="root"></div>');
    assert.equal(themeMcpAppHtml(GANTT, once), once);
  });

  it('Compass 那条 uri 也要盖 —— 只认 widget/gantt.html 会漏掉真机', () => {
    const html = '<svg></svg>';
    assert.ok(themeMcpAppHtml('ui://compass/gantt.html', html).includes('--ok:#d4e4e7'));
    assert.ok(themeMcpAppHtml('ui://compass/gantt', html).includes('--ok:#d4e4e7'));
  });

  it('缩放滑条不再走浏览器默认蓝点', () => {
    const out = themeMcpAppHtml(GANTT, '<input type="range">');
    assert.ok(out.includes('input[type=range]'), '没盖滑条');
    assert.ok(!out.includes('#0075ff') && !out.includes('#0078d4'));
  });

  it('虚线全部收成实线,不要点阵也不要通配框', () => {
    const out = themeMcpAppHtml(GANTT, '<svg></svg>');
    assert.ok(out.includes('stroke-dasharray:none!important'), '虚线没收');
    assert.ok(out.includes('pattern{display:none!important}'), '点阵图案没压掉');
    assert.ok(!out.includes('stroke-dasharray:16 8'), '细虚线还在');
    assert.ok(!out.includes('*{border-style'), '通配实线边框会把每个标签都框起来');
  });

  it('条变瘦、行距变疏,整图高度不动', () => {
    const out = themeMcpAppHtml(GANTT, '<svg></svg>');
    assert.ok(out.includes('scaleY(.7)'), '条没变瘦');
    assert.ok(out.includes('transform-box:fill-box'), '没按每条自己的中心缩放');
    assert.ok(!out.includes('svg{transform'), '整张图被缩放了');
  });
});
