/**
 * 通用 MCP 授权,在真界面上点一遍。
 *
 * 验的是"加任何一个需要授权的 MCP 服务器,都不用手工去找一张 token":
 * 行上出现「授权」→ 点 → 走完标准 OAuth → 行变成「撤销授权」。
 *
 * 前置(两个真服务 + 一台真的会 401 的 MCP):
 *   cd apps/server && VEYLIN_DATA_DIR=/tmp/vg PORT=8795 VEYLIN_DESKTOP_AUTH=1 \
 *     VEYLIN_COMPASS_IDENTITY= npx tsx src/server.ts
 *   cd apps/web && VITE_API_URL=http://127.0.0.1:8795 npx vite --port 5198
 *   curl -X POST localhost:5198/api/mcp-servers -H 'Content-Type: application/json' \
 *     -d '{"name":"compass-generic","transport":"http","url":"http://127.0.0.1:8000/mcp/","enabled":true}'
 *   node e2e/generic-mcp-auth.mjs
 *
 * 非桌面端开不了内置浏览器 —— 界面按设计降级成"把授权链接显示出来"。这个脚本
 * 正好利用那条降级路拿到链接,再开一页把授权走完(等价于用户在内置浏览器里操作)。
 */
import { chromium } from '@playwright/test';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
p.setDefaultTimeout(20000);
const seen = [];
p.on('request', (r) => seen.push(r.url()));

const gotoMcp = async () => {
  await p.goto('http://127.0.0.1:5198', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4500);
  await p.locator('button').first().click().catch(() => {});
  await p.waitForTimeout(800);
  await p.getByText('Customize', { exact: true }).first().click();
  await p.waitForTimeout(1200);
  await p.getByText('MCP', { exact: true }).first().click();
  await p.waitForTimeout(3000);
};
const openRowMenu = async () => {
  const title = p.getByText('compass-generic', { exact: false }).first();
  await title.locator('xpath=ancestor::*[.//button][1]//button').last().click();
  await p.waitForTimeout(900);
};

await gotoMcp();
await openRowMenu();
// 可重复跑:上一次跑完会停在"已授权"。先撤销回到起点,否则第二次跑必然找不到
// 「授权」而超时 —— 一个只能跑一次的 e2e 脚本,等于下次没人会跑。
if ((await p.innerText('body')).includes('撤销授权')) {
  await p.getByText('撤销授权', { exact: true }).first().click();
  await p.waitForTimeout(2000);
  await openRowMenu();
}
await p.getByText('授权', { exact: true }).first().click();
await p.waitForTimeout(2500);

// 拿到授权链接后,在浏览器里真的走一遍(注册账号 → 登录并授权 → 回调)
const line = (await p.innerText('body')).split('\n').find((l) => l.includes('oauth/authorize'));
const authUrl = line.slice(line.indexOf('http'));
const q = Object.fromEntries(new URL(authUrl).searchParams);

const page2 = await b.newPage();
await page2.goto('http://127.0.0.1:8000/oauth/signup', { waitUntil: 'domcontentloaded' });
await page2.fill('input[name=email]', 'generic-ui@test.local');
await page2.fill('input[name=password]', 'a-good-password');
await page2.click('button[type=submit]');
await page2.waitForTimeout(800);

await page2.goto(authUrl, { waitUntil: 'domcontentloaded' });
const consent = (await page2.innerText('body')).split('\n').find((l) => l.includes('想代表你使用')) ?? '';
console.log('① 同意页写明了范围:', consent.slice(0, 60) || '(没找到 —— 同意页该说清授权了什么)');
await page2.fill('input[name=email]', 'generic-ui@test.local');
await page2.fill('input[name=password]', 'a-good-password');
await page2.click('button[value=approve]');
await page2.waitForTimeout(3500);
console.log('② 回调页:', (await page2.innerText('body')).split('\n').slice(0, 2).join(' | '));
await page2.close();

// 回到设置页,等前端轮询把状态刷过来
await p.waitForTimeout(4000);
await openRowMenu();
const menu = await p.innerText('body');
console.log('③ 授权后菜单:', menu.includes('撤销授权') ? '变成「撤销授权」' : '仍是「授权」← 没生效');
await p.screenshot({ path: '/tmp/e2e_generic_done.png', fullPage: true });
await b.close();
