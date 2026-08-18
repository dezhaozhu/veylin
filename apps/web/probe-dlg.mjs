import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1500,height:1000} });
await p.goto('http://localhost:5175/'); await p.waitForTimeout(6000);
const has = await p.evaluate(() => ({
  workspace: Boolean(document.querySelector('[data-slot="chat-workspace"]')),
  inset: Boolean(document.querySelector('[data-slot="sidebar-inset"]')),
}));
console.log('布局锚点:', JSON.stringify(has));
await b.close();
