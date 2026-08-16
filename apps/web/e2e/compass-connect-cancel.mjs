/**
 * 「取消」必须真的取消:关掉授权用的浏览器窗口,并停掉轮询。
 *
 * 这条是实测暴露出来的 —— 之前点开授权后窗口关不掉,取消了轮询还在后台跑满
 * 五分钟。用户截图里就卡在那个状态。
 */
import { chromium } from '@playwright/test';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
p.setDefaultTimeout(20000);
const polls = [];
p.on('request', (r) => { if (r.url().includes('/oauth/status')) polls.push(Date.now()); });

await p.goto('http://127.0.0.1:5198', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4500);
await p.locator('button').first().click().catch(() => {});
await p.waitForTimeout(800);
await p.getByText('Customize', { exact: true }).first().click();
await p.waitForTimeout(1200);
await p.getByText('MCP', { exact: true }).first().click();
await p.waitForTimeout(2500);

await p.getByRole('button', { name: '连接' }).first().click();
await p.waitForTimeout(800);
await p.getByText('用浏览器登录', { exact: true }).click();
await p.waitForTimeout(4000);
const during = polls.length;
console.log('① 授权进行中,已轮询次数:', during, during > 0 ? '(在等)' : '(没起来?)');

await p.getByText('取消', { exact: true }).first().click();
await p.waitForTimeout(1000);
const atCancel = polls.length;
console.log('② 点了取消,表单还在吗:', (await p.innerText('body')).includes('用浏览器登录') ? '还在 ← 没关掉' : '已收起');

await p.waitForTimeout(7000);
console.log('③ 取消 7 秒后又轮询了几次:', polls.length - atCancel, polls.length - atCancel === 0 ? '(停住了)' : '← 还在后台跑');
await p.screenshot({ path: '/tmp/e2e_cancel.png', fullPage: true });
await b.close();
