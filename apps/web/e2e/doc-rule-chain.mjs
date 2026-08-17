/**
 * 端到端:文档 → 对照 → 改 → 那一问 → 规则提案。
 *
 * 每一段单独都有测试,但整条串起来跑没验过 —— 而今天反复出现的规律是:
 * 单测全绿、串起来才露馅。第一次跑就抓到四件事:部署部错了机器、本机容器挂的是
 * 源码但跑的是启动时导入的旧模块、探针写错、以及改完之后引述变了导致提案查不到。
 *
 * 真界面 + 真 LLM + 真 Compass(上重/shangzhong)。提示词里点名工具,是为了让这条
 * 脚本测的是**链路**而不是模型的选择能力 —— 那是另一个问题,不该混在一条冒烟里。
 *
 * **断言看的是工具的真实回参,不是流里的关键字。** 第一版断言 get_op_eligibility
 * 出现在 chat 流里 —— 可它是 reconcile_document 在服务端内部调的,模型根本看不到:
 * 断言错了却看起来像功能坏了,差点去改没坏的代码。
 *
 * 跑法:先起 npm run dev,给「上重」绑一个含工艺说明的文件夹,然后 node 这个文件。
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const URL = process.env.VEYLIN_URL ?? 'http://localhost:5174';
const fails = [];
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fails.push(name);
};

/**
 * **不从 SSE 文本里读中文。** 这条流的 charset 没声明,Playwright 按 latin1 解,
 * 中文全成乱码;我试着还原,反而越修越坏(切片切断多字节 → 整体还原又双重解码)。
 *
 * 而且更根本的一点:**流里的措辞是模型写的,不是产品的事实**。真正该断言的是
 * 这条链**留下了什么** —— 副本建没建、版本落没落、提案进没进 Compass 的库。
 * 那些既是真结果,也不受编码和模型措辞影响。
 *
 * 所以流只用来看**调了哪个工具**(toolName 是 ASCII),中文结论一律走 API/磁盘核对。
 */
const calledTools = (raw) => new Set([...raw.matchAll(/"toolName":"([a-zA-Z_]+)"/g)].map((m) => m[1]));

const api = async (path) => (await p.request.get(`${URL}${path}`)).json();

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.setDefaultTimeout(30000);

let stream = '';
p.on('response', async (r) => {
  if (!r.url().includes('/api/chat')) return;
  try { stream += await r.text(); } catch { /* 流可能已被消费 */ }
});

async function say(text, waitMs) {
  // **只取可见的那个** —— 项目页背后还压着对话那一个。
  await p.locator('textarea:visible').first().click();
  await p.keyboard.type(text);
  await p.waitForTimeout(300);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(waitMs);
}

await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);
await p.locator('button').first().click().catch(() => {});
await p.waitForTimeout(1500);
await p.getByText('上重', { exact: true }).first().click();
await p.waitForTimeout(3000);
ok('进到上重项目页', await p.getByText('在「上重」里问点什么').first().isVisible().catch(() => false));

const PROJ = '8657aa7d-8279-472d-9a9d-a71544c0f217';   // 上重(挂着 shangzhong)
const { execSync } = await import('node:child_process');
/** Compass 库里 doc 来源的提案数。**跑之前先取基线** —— 「库里有」不等于「这一轮提的」。 */
const docProposalCount = () => {
  try {
    return Number(execSync(
      `docker exec compass-v2-app-1 python -c "` +
      `import os;from compass_persistence.db import get_engine,tenant_session;` +
      `from compass_persistence.repositories import ProposalRepository;` +
      `e=get_engine(os.environ['COMPASS_DB_URL']);` +
      `s=tenant_session(e,'shangzhong').__enter__();` +
      `print(len([p for p in ProposalRepository(s).list_proposals('shangzhong') if 'doc:' in p.proposal_id]))"`,
      { encoding: 'utf8', timeout: 60000 },
    ).trim());
  } catch { return -1; }
};

const baseline = docProposalCount();
console.log(`  (提案基线:${baseline} 条)`);

console.log('\n① 对照 —— 真 Compass、真 shangzhong 数据');
stream = '';
await say('用 reconcile_document 对照 工艺说明.md,逐条说结论', 90000);
const t1 = calledTools(stream);
ok('调了 reconcile_document', t1.has('reconcile_document'));
// 取不到事实那条错会让整轮变成一句 error —— 用它当反向判据,比猜措辞可靠。
// 「没取到可比对的事实」那条错在流里是乱码,直接匹配不到 —— 换个不受编码影响的
// 判据:真取到事实时这一轮会长得多(逐条结论 + 事实),取不到就只有一句 error。
ok('**真取到了系统侧事实**(不是一句 error 就结束)', stream.length > 6000, `${stream.length} 字节`);

console.log('\n② 改 —— 断言副本和版本真的落了');
stream = '';
await say('用 document_edit 把 工艺说明.md 里「| 性能热处理 | 锻件分厂 | 合金钢类需要 |」这一整行改成「| 性能热处理 | 大锻所 | 合金钢类需要 |」', 90000);
const t2 = calledTools(stream);
ok('调了 document_edit', t2.has('document_edit'));
const ctx = await api(`/api/project/context?projectId=${PROJ}`);
const files = (ctx.files ?? []).map((f) => f.name);
ok('**副本建出来了**(原件不动,改落在文稿/)', files.some((n) => n.startsWith('文稿/')), files.join(' · '));
ok('原件还在', files.includes('工艺说明.md'));
const copy = await api(`/api/project/file?projectId=${PROJ}&name=${encodeURIComponent('文稿/工艺说明.md')}`);
ok('**副本里真的是改后的内容**', String(copy.text ?? '').includes('大锻所'));

console.log('\n③ 一起改 → 规则提案(断言提案真进了 Compass)');
stream = '';
await say('文档和规则一起改。用 propose_rule_from_document 把「性能热处理」那句提成规则提案', 120000);
const t3 = calledTools(stream);
ok('调了 propose_rule_from_document', t3.has('propose_rule_from_document'));
// **这一轮有没有新提案进库**,是这一步唯一算数的事实 —— 流里的措辞是模型写的。
const after = docProposalCount();
ok('**这一轮真的新增了提案**', after > baseline, `${baseline} → ${after}`);

await p.screenshot({ path: '/tmp/doc-rule-chain.png' });
await b.close();
console.log(`\n${fails.length ? `✖ ${fails.length} 条没过:\n  - ${fails.join('\n  - ')}` : '✔ 全过'}`);
process.exit(fails.length ? 1 : 0);
