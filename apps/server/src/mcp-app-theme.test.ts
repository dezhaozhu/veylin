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

  it('别的 widget 只盖滚动条,不改编配色', () => {
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
