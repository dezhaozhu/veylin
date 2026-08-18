/**
 * **像用户那样走一遍**:新建项目 → 放进 xlsx/docx/pptx → 看 context → 对话里改 →
 * 同一个项目里新开对话接着改。
 *
 * 为什么非得真跑:今天三个 bug 全是用户在真界面点出来的,而逻辑层测试当时全绿 ——
 *  · 附件在**第二轮**把对话毒死(第一轮好好的,所以单轮 smoke 测不出来);
 *  · 那一轮的错误被吞掉,界面只剩空白;
 *  · 切表时迟到的响应盖住当前表,看起来像"点不动"。
 * 所以这条链路**用真模型跑真轮次**,而且必须跑到第二轮。
 *
 * 跑法(整栈隔离,不碰用户在用的 :8787 和真实数据):
 *   npx playwright test -c playwright.isolated.config.ts
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = `http://127.0.0.1:${process.env.E2E_API_PORT ?? '8799'}`;

const PROJECT = 'E2E 组件';
const XLSX_NAME = '开发组件.xlsx';
const DOCX_NAME = '技术交流.docx';
const PPTX_NAME = '汇报.pptx';
const PDF_NAME = '标书.pdf';

/** 真文件,不是占位符 —— 抽取器读不了假 zip。 */
async function makeFixtureFolder(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'veylin-e2e-folder-'));

  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet([
    { 序号: 1, 型号: 'CZ225 控制器', 数量: 2 },
    { 序号: 2, 型号: 'CA381 终端', 数量: 1 },
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '组件');
  writeFileSync(join(dir, XLSX_NAME), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

  const JSZip = (await import('jszip')).default;
  const docx = new JSZip();
  docx.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  );
  docx.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );
  docx.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>年度交付目标是八月底完成。</w:t></w:r></w:p></w:body></w:document>',
  );
  writeFileSync(join(dir, DOCX_NAME), await docx.generateAsync({ type: 'nodebuffer' }));

  const pptx = new JSZip();
  pptx.file(
    'ppt/slides/slide1.xml',
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:p><a:r><a:t>产线扩产方案</a:t></a:r></a:p></p:sld>',
  );
  writeFileSync(join(dir, PPTX_NAME), await pptx.generateAsync({ type: 'nodebuffer' }));
  writeFileSync(join(dir, PDF_NAME), minimalPdf('Compass boundary test'));

  return dir;
}

/**
 * 一份最小但**真能渲染**的 PDF(一页 + Helvetica 一行字)。
 * 假 PDF 没意义:卡片封面和文档面板走的是真渲染(unpdf + canvas),
 * 喂个空壳只能测到"没崩",测不到"画出来了"。
 */
function minimalPdf(text: string, pages = 2): Buffer {
  // 至少两页:单页 PDF 在文档面板里走的是"预览"而不是分页 —— 想测分页那条路,
  // 样本就得真有第二页(第一版一页,断言"画出第 1 页"直接落空)。
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  const objs: Array<string | null> = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
  ];
  const fontObj = 3 + pages * 2;
  for (let i = 0; i < pages; i++) {
    const contentObj = 4 + i * 2;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] `
        + `/Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentObj} 0 R >>`,
    );
    const stream = `BT /F1 18 Tf 20 80 Td (${text} p${i + 1}) Tj ET`;
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function openSidebar(page: Page): Promise<void> {
  const newProject = page.getByRole('button', { name: 'New project' }).first();
  if (((await newProject.boundingBox())?.x ?? -1) < 0) {
    await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click();
    await expect
      .poll(async () => (await newProject.boundingBox())?.x ?? -1)
      .toBeGreaterThan(0);
  }
}

test('新建项目 → 放进办公文件 → context 认得出来', async ({ page, request }) => {
  const folder = await makeFixtureFolder();

  await page.goto('/');
  await openSidebar(page);

  // —— 建项目(不选数据源:这个项目和 Compass 无关)
  await page.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.locator('[role=dialog]').first();
  await dialog.locator('input').first().fill(PROJECT);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();

  const listed = await (await request.get(`${API}/api/projects`)).json();
  const project = (listed.projects as Array<{ id: string; name: string; sources: string[] }>)
    .find((p) => p.name === PROJECT);
  expect(project, '项目没建出来').toBeTruthy();
  expect(project!.sources, '这个项目不该带数据源').toEqual([]);

  // 绑项目文件夹。**这一步走 API**:选文件夹是操作系统的原生对话框,
  // Playwright 驱动不了 —— 这是整条链路里唯一一处不是"真点"的地方。
  const patched = await request.patch(`${API}/api/projects/${project!.id}`, {
    data: { folder },
  });
  expect(patched.ok(), '绑文件夹失败').toBeTruthy();

  // —— 项目页:三种办公文件都该被认出来
  // 侧栏那一行是个复合按钮(展开/更多/新对话都在里面),按文字点最贴近真人操作。
  await page.getByText(PROJECT, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: PROJECT })).toBeVisible({ timeout: 15_000 });

  // 上下文改成卡片之后:**少量文件一张张摆**(能看到类型/大小/PDF 封面),
  // 多了才折叠成一张文件夹卡。这里放了四份,所以四张卡都该在。
  await expect(page.getByText('4 项', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  for (const name of [XLSX_NAME, DOCX_NAME, PPTX_NAME, PDF_NAME]) {
    await expect(
      page.getByRole('button', { name: new RegExp(name) }).first(),
      `context 里没有 ${name} 这张卡`,
    ).toBeVisible({ timeout: 20_000 });
  }
});

/**
 * **第二轮才是现场。** 附件在第一轮被抽成文本、答得好好的;一旦第一轮调过工具,
 * 第二轮就改走 convertToModelMessages,原样把 file part 递给 provider —— 从前
 * 这里当场抛 UnsupportedFunctionality,那一轮变成空白,用户看到的是"对话没了"。
 */
test('带附件问两轮,第二轮不许是空白', async ({ page, request }) => {
  const folder = await makeFixtureFolder();
  await page.goto('/');
  await openSidebar(page);
  await page.getByText(PROJECT, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: PROJECT })).toBeVisible({ timeout: 15_000 });

  // 项目页那个输入框就是真的 Composer —— 从这儿发第一句,新对话会自动归到本项目。
  const composer = page.locator('textarea:visible').first();
  // 点一下输入框会**当场新建并钉一条对话**,组件跟着重挂 —— 不等它稳下来就丢文件,
  // 附件会落到已经被替换掉的那个上(实测过一次)。
  await composer.click();
  await page.waitForTimeout(2500);

  // 第一轮:带附件,并且要让它**调一次工具**(这是毒丸生效的前提)
  await dropFile(page, join(folder, XLSX_NAME), XLSX_NAME);
  // 一定要让它**真动一次工具**:毒丸只在"第一轮调过工具"之后才发作
  // (那时才改走 convertToModelMessages,把原始 file part 递给 provider)。
  await composer.fill(
    '把这个附件里的数据导入表格面板,新建一张叫「组件」的表,并加一列「日期」填今天。完成后告诉我建了几行。',
  );
  await composer.press('Enter');
  const first = await waitForAssistantText(page, 1);
  expect(first.length, `第一轮就是空的:${first}`).toBeGreaterThan(0);

  // 这个项目没接数据源,右侧表格面板就不该讲 Compass 的故事
  // (从前无条件 POST load-compass-schedule,还会在这种项目里真建一张工序表)。
  await openTablePanel(page);
  await page.waitForTimeout(3000);
  await expect(
    page.getByText('Compass', { exact: false }),
    '没接数据源的项目里出现了 Compass 字样',
  ).toHaveCount(0);

  // **先确认这一轮真的把附件送进了历史。** 附件没进去,这条测试就等于没测到那个
  // bug 却照样变绿 —— 今天已经吃过一次"断言看着过了、其实没测到"的亏。
  const threadId = await latestThreadId(request);
  await expect
    .poll(async () => JSON.stringify(await historyOf(request, threadId)), { timeout: 60_000 })
    .toContain('"type":"file"');

  // 第二轮:普通追问 —— 从前这里必死
  await composer.fill('刚才那个数字再说一遍就行。');
  await composer.press('Enter');
  const second = await waitForAssistantText(page, 2);
  expect(second.length, '第二轮是空白 —— 附件毒丸又回来了').toBeGreaterThan(0);
  expect(second, '第二轮报了错').not.toMatch(/这一轮没有产出任何内容/);

  // 毒丸只在"第一轮调过工具"时才发作(那时才改走 convertToModelMessages)。
  // 没调过工具的话这条测试根本没走到出问题的分支 —— 得说出来,不能默默变绿。
  const finalHistory = JSON.stringify(await historyOf(request, threadId));
  expect(finalHistory, '第一轮没调工具 —— 没走到出问题的那条分支,这条测试是空跑')
    .toMatch(/"type":"tool-/);
});

/**
 * 等到这条对话**真的归到了项目**再往下走。
 *
 * 点开项目页的输入框会异步地「新建线程 + 钉项目」。不等钉定落地就去拉 Compass,
 * 那一拉会落到个人区 —— 作用域里一张表都没有,后面所有关于云端表的断言都会红,
 * 而看起来像是产品坏了(实测栽过一次:线程根本没归项目,我却在查"云端表的列")。
 */
async function waitPinned(
  request: APIRequestContext,
  threadId: string,
  projectId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const map = await (await request.get(`${API}/api/projects/threads`)).json();
        return map[threadId] ?? null;
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(projectId);
}

async function latestThreadId(request: APIRequestContext): Promise<string> {
  const body = await (await request.get(`${API}/api/threads`)).json();
  const list = body.threads as Array<{ remoteId?: string; id?: string }>;
  const id = list[0]?.remoteId ?? list[0]?.id;
  expect(id, '拿不到刚才那条对话').toBeTruthy();
  return id!;
}

async function historyOf(request: APIRequestContext, threadId: string): Promise<unknown> {
  return (await request.get(`${API}/api/threads/${threadId}/messages`)).json();
}

/**
 * 打开右侧的表格面板。
 *
 * **走 app 自己的 API,不靠几何。** 从前是去点那个"选面板类型"的大卡片:右栏
 * 可能整个收着、可能开着却被左栏挤到视口外、卡片还在动画里 —— 三种情况轮流
 * 失败,红了却与产品无关(实测让两条测试反复变红,我一度以为是产品坏了)。
 * dev 钩子暴露的就是面板自己的 open('table')。
 */
async function openTablePanel(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__veylinTest?.openTablePanel), undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__veylinTest!.openTablePanel());
  // 判"面板开了"看容器上的 data-panel-kind,别看页签栏 —— 空作用域下表格走
  // 空状态早退,页签栏根本不渲染,拿它当判据会冤枉面板(踩过一轮)。
  await expect(
    page.locator('[data-panel-kind=table]'),
    '表格面板没打开 —— 后面的断言与产品无关',
  ).toBeVisible({ timeout: 20_000 });
}

/**
 * 把文件拖进输入框。桌面端走的是操作系统的文件对话框,浏览器里没有 input[type=file],
 * 所以合成一个真的 DragEvent —— 这也正是用户"把文件拖进对话框"的那条路。
 */
async function dropFile(page: Page, path: string, name: string): Promise<void> {
  const b64 = readFileSync(path).toString('base64');
  await page.evaluate(
    ({ b64, name }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: 'application/octet-stream' }));
      // 页面上同时挂着好几个 textarea(项目页的、聊天页的),只有一个真的在屏幕上;
      // 用 activeElement 会踩空 —— 输入框刚被重挂时焦点还没回来。
      const target =
        [...document.querySelectorAll('textarea')].find((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }) ?? document.body;
      target.dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
      );
    },
    { b64, name },
  );
}

/**
 * 等到第 n 条助手消息出现、有正文、**并且这一轮真的结束了**。
 *
 * 只等"出现了正文"是不够的:那时还在流式输出,输入框是禁用的,紧接着 fill+Enter
 * 会**整句丢掉**,然后测试就在等一条永远不会来的消息(实测白等了 8 分钟)。
 * 判据取两条:正文连续两次取样不再变,且发送键回到可用。
 */
async function waitForAssistantText(page: Page, n: number): Promise<string> {
  const messages = page.locator('[data-role=assistant], .aui-assistant-message');
  const textOf = async () => {
    if ((await messages.count()) < n) return '';
    return (await messages.nth(n - 1).innerText()).trim();
  };

  let previous = '';
  await expect
    .poll(
      async () => {
        const current = await textOf();
        // 判"还在跑"要看**停止生成**那个键在不在。
        // 别拿发送键的可用性当判据:输入框空着时它本来就是禁用的,
        // 于是一轮明明早就答完了,测试还能傻等满 8 分钟(实测)。
        const idle = (await page.getByRole('button', { name: 'Stop generating' }).count()) === 0;
        const settled = current.length > 0 && current === previous && idle;
        previous = current;
        return settled;
      },
      { timeout: 8 * 60_000, intervals: [2500] },
    )
    .toBe(true);
  return textOf();
}

/**
 * **同一个项目里新开一条对话,接着改上一轮建的东西。**
 *
 * 项目的意义就在这儿:换一条对话,表还在、上下文还在、agent 还认得。
 * 判据不看它嘴上怎么说,直接查那张表的列真的多了没有。
 */
test('同项目新开对话,还能接着改上一轮建的表', async ({ page, request }) => {
  await page.goto('/');
  await openSidebar(page);
  await page.getByRole('button', { name: `New chat in ${PROJECT}` }).first().click();
  await page.waitForTimeout(2500);

  const composer = page.locator('textarea:visible').first();
  await composer.click();
  await page.waitForTimeout(1500);
  await composer.fill('在表格面板的「组件」表里加一列「日期」,值填 2026-08-17。');
  await composer.press('Enter');
  const reply = await waitForAssistantText(page, 1);
  expect(reply.length, '新对话里一句话都没答上').toBeGreaterThan(0);

  // 不信它的话,查表本身:列真的加上了吗。
  const threadId = await latestThreadId(request);
  const sheets = await (
    await request.get(`${API}/api/table/sheets?threadId=${threadId}`)
  ).json();
  const sheet = (sheets.sheets as Array<{ id: string; name: string }>)
    .find((s) => s.name === '组件');
  expect(sheet, '新对话看不到上一轮建的「组件」表 —— 项目没把上下文带过来').toBeTruthy();

  const data = await (
    await request.get(
      `${API}/api/table?sheet=${encodeURIComponent(sheet!.id)}&threadId=${threadId}`,
    )
  ).json();
  const columns = (data.columns as Array<{ name: string }>).map((c) => c.name);
  expect(columns, `列没加上,现有列:${columns.join('/')}`).toContain('日期');
});

/**
 * **本地项目文件 + Compass 云端,两张表能不能一起读。**
 *
 * 真实工作里最常见的一种:一半事实在云端排产库(工序表),一半在你自己电脑上的
 * 一份 xlsx。如果 agent 只够得到其中一张,"项目"这个容器就是假的。
 *
 * 判据不看它嘴上说什么:直接查这个作用域里到底有没有两张表、各自有没有行。
 */
test('本地表 + Compass 云端表,能一起读', async ({ page, request }) => {
  const folder = await makeFixtureFolder();

  // 锅炉厂是带 compass 数据源的托管项目 —— 再给它绑一个本地文件夹,
  // 于是同一个项目里既有云端的工序表,也有本地的 xlsx。
  const listed = await (await request.get(`${API}/api/projects`)).json();
  const guolu = (listed.projects as Array<{ id: string; name: string; sources: string[] }>)
    .find((p) => p.sources.includes('guolu'));
  test.skip(!guolu, '这台机器上没有接 guolu 的项目');
  await request.patch(`${API}/api/projects/${guolu!.id}`, { data: { folder } });

  await page.goto('/');
  await openSidebar(page);
  // 走项目页那个输入框:侧栏的「新对话」只建线程、不跳转,进不了对话页。
  await page.getByText(guolu!.name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: guolu!.name })).toBeVisible({ timeout: 15_000 });

  const composer = page.locator('textarea:visible').first();
  await composer.click();
  await page.waitForTimeout(2500);
  await composer.fill('把项目文件夹里的 开发组件.xlsx 导入表格面板,建一张新表。');
  await composer.press('Enter');
  expect((await waitForAssistantText(page, 1)).length, '第一轮没答上').toBeGreaterThan(0);

  // 云端那张是**表格面板挂载时**去拉的。这一步走接口(和绑文件夹一样标注清楚):
  // 面板本身的开关有另一条测试盯着,这条的正题是"两张表能不能一起读"。
  const threadIdForLoad = await latestThreadId(request);
  await waitPinned(request, threadIdForLoad, guolu!.id);
  const loaded = await request.post(`${API}/api/table/load-compass-schedule`, {
    data: { threadId: threadIdForLoad },
  });
  const loadBody = await loaded.json();
  expect(loadBody.ok, `云端表没拉下来:${JSON.stringify(loadBody).slice(0, 200)}`).toBeTruthy();

  // 正题:一个问题要同时够到两张表。
  await composer.fill('表格面板里现在有哪些表?工序表有多少行?刚导入那张有多少行?');
  await composer.press('Enter');
  const reply = await waitForAssistantText(page, 2);

  const threadId = await latestThreadId(request);
  const sheets = (
    await (await request.get(`${API}/api/table/sheets?threadId=${threadId}`)).json()
  ).sheets as Array<{ id: string; name: string; source?: { server?: string } }>;
  const names = sheets.map((s) => s.name).join('/');

  const fromCloud = sheets.find((s) => s.source?.server === 'compass');
  // 既不能写死表名,也不能松到"任何一张没有 source 的表":
  //  · 写死 →「开发组件」被模型起成「开发组件导入」就红,测的成了它的命名习惯;
  //  · 太松 → 上一轮跑剩的空壳表也能蒙混过关(那一轮 agent 只建了壳,断言却绿)。
  // 取中间:名字里带「开发组件」、且不是云端来的那张;有没有行下面单独验。
  const stem = XLSX_NAME.replace(/\.[^.]+$/, '');
  const fromLocal = sheets.find((s) => !s.source && s.name.includes(stem));
  expect(fromCloud, `作用域里没有云端表,现有:${names}`).toBeTruthy();
  expect(fromLocal, `没有「开发组件」这张本地表,现有:${names}`).toBeTruthy();

  // 两张都真有行,才谈得上"读得到"。
  for (const sheet of [fromCloud!, fromLocal!]) {
    const data = await (
      await request.get(
        `${API}/api/table?sheet=${encodeURIComponent(sheet.id)}&threadId=${threadId}`,
      )
    ).json();
    expect((data.rows as unknown[]).length, `「${sheet.name}」是空的`).toBeGreaterThan(0);
  }

  expect(reply.length, '一句话都没答上').toBeGreaterThan(0);
});

/**
 * **大表和小表之间来回切,不许串屏。**
 *
 * 今天修过一个"点不动":切表会重建 SSE,旧连接的 onopen 迟到一步、用过期闭包
 * 再拉一次上一张表,把当前这张盖掉。**表越大,那个窗口越宽** —— 云端工序表
 * 七千多行,正好是最恶劣的一档。
 *
 * 判据不是"点了没报错",而是**屏幕上这一刻显示的列,属于当前选中的那张表**。
 */
test('大表 ⇄ 小表来回切,屏幕上的列始终属于当前那张', async ({ page, request }) => {
  const folder = await makeFixtureFolder();
  const listed = await (await request.get(`${API}/api/projects`)).json();
  const guolu = (listed.projects as Array<{ id: string; name: string; sources: string[] }>)
    .find((p) => p.sources.includes('guolu'));
  test.skip(!guolu, '这台机器上没有接 guolu 的项目');
  await request.patch(`${API}/api/projects/${guolu!.id}`, { data: { folder } });

  await page.goto('/');
  await openSidebar(page);
  await page.getByText(guolu!.name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: guolu!.name })).toBeVisible({ timeout: 15_000 });

  // 进一条对话(项目页的输入框会当场建并钉一条),再把两张表准备好。
  const composer = page.locator('textarea:visible').first();
  await composer.click();
  await page.waitForTimeout(2500);
  const threadId = await latestThreadId(request);
  await waitPinned(request, threadId, guolu!.id);
  await request.post(`${API}/api/table/load-compass-schedule`, { data: { threadId } });

  const sheets = (
    await (await request.get(`${API}/api/table/sheets?threadId=${threadId}`)).json()
  ).sheets as Array<{ id: string; name: string; source?: { server?: string } }>;
  const cloud = sheets.find((s) => s.source?.server === 'compass');
  test.skip(!cloud, '这个项目里没有云端表');

  // **小表自己造,不靠模型去导。** 共用的数据目录里堆着历次跑剩的同名空表
  // (开发组件导入、开发组件-导入、Sheet 2..8…),按名字点很容易点中一张空的 ——
  // 于是断言红了,看起来像"切表坏了",其实是测试数据不干净(实测栽过一次)。
  const localName = `小表-${Date.now()}`;
  const created = await request.post(`${API}/api/table/sheets`, {
    data: { name: localName, threadId },
  });
  expect((await created.json()).ok, '小表没建出来').toBeTruthy();
  const localId = (await (await request.get(`${API}/api/table/sheets?threadId=${threadId}`)).json())
    .sheets.find((x: { name: string; id: string }) => x.name === localName)!.id;
  await request.post(`${API}/api/table/import`, {
    data: {
      sheet: localId,
      threadId,
      column_names: ['型号', '数量'],
      rows: [{ 型号: 'CZ225', 数量: '2' }],
    },
  });

  // 先说一句把视图带进对话:项目页是盖住全屏的,右侧面板在它下面是隐藏的,
  // 直接开面板会开在看不见的地方(实测:容器在、visible 为 false)。
  await composer.fill('说一句知道了就行。');
  await composer.press('Enter');
  await waitForAssistantText(page, 1);

  await openTablePanel(page);
  await page.waitForTimeout(4000);

  // 来回切三次,每次都要求"当前页签"和"屏幕上的列"对得上。
  for (const name of [cloud!.name, localName, cloud!.name, localName]) {
    await page.getByRole('button', { name, exact: true }).first().click();
    // 先分清"点了没切过去"和"切了但内容没跟":选中的页签会变成实心。
    await expect
      .poll(async () => (await page
        .locator('[data-testid=sheet-tabs] .group\\/tab.bg-primary')
        .allInnerTexts()).join('').replace(/\s+/g, ''), { timeout: 20_000, intervals: [500] })
      .toContain(name.replace(/\s+/g, ''));
    // 切表是异步的:等到这张表自己的列真的上了屏。
    const marker = name === localName ? '型号' : '订单号';
    await expect
      .poll(
        async () => (await page.locator('[data-panel-kind=table]').innerText()).replace(/\s+/g, ' '),
        { timeout: 60_000, intervals: [1000] },
      )
      .toContain(marker);
  }
});

/**
 * **把一条对话改钉到别的项目,右侧表格必须跟着换。**
 *
 * 输入框上的项目选择器让"同一条对话改归属"变成了一个随手的动作。可面板从前只认
 * threadId:改钉之后 threadId 没变,屏幕上还摆着**上一个项目的表** —— 这轮对话
 * 已经归给了新项目,而你在面板里的编辑会落到旧项目的表上。
 *
 * 判据:改钉之后,旧项目那张独有的表**不能再出现在页签里**。
 */
test('改钉到别的项目,表格面板跟着换作用域', async ({ page, request }) => {
  const folder = await makeFixtureFolder();
  const listed = await (await request.get(`${API}/api/projects`)).json();
  const projects = listed.projects as Array<{ id: string; name: string; sources: string[] }>;
  const guolu = projects.find((p) => p.sources.includes('guolu'));
  const other = projects.find((p) => p.id !== guolu?.id);
  test.skip(!guolu || !other, '这台机器上项目不够两个');
  await request.patch(`${API}/api/projects/${guolu!.id}`, { data: { folder } });

  await page.goto('/');
  await openSidebar(page);
  await page.getByText(guolu!.name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: guolu!.name })).toBeVisible({ timeout: 15_000 });

  const composer = page.locator('textarea:visible').first();
  await composer.click();
  await page.waitForTimeout(2500);

  // 在锅炉厂这边留下一张只属于它的表(云端工序表)。
  const threadId = await latestThreadId(request);
  await waitPinned(request, threadId, guolu!.id);
  await request.post(`${API}/api/table/load-compass-schedule`, { data: { threadId } });

  // 让旧项目有一张**独有**的表:两个项目都接着 compass、都可能有「工序」,
  // 只按那个名字断言分不出来(第一版栽过)。
  // 这一步走接口而不是让模型去导:这条测试的正题是"改钉之后面板跟不跟",
  // 把它压在模型的发挥上,红了也分不清是哪一头的问题(第一次验证就栽在这儿)。
  const uniqueSheet = `只属于锅炉厂-${Date.now()}`;
  await request.post(`${API}/api/table/sheets`, { data: { name: uniqueSheet, threadId } });

  await composer.fill('说一句知道了就行。');
  await composer.press('Enter');
  await waitForAssistantText(page, 1);

  await openTablePanel(page);
  await page.waitForTimeout(4000);
  await expect(
    page.getByRole('button', { name: uniqueSheet, exact: true }).first(),
    '锅炉厂这边本来就该有那张独有的表',
  ).toBeVisible({ timeout: 30_000 });

  // —— 用输入框上的选择器改钉到另一个项目(这正是新做的那个动作)。
  // **精确名**:侧栏那些按钮叫「New chat in X」「Expand or collapse X …」,
  // 只有输入框上那个 chip 的可访问名恰好等于项目名。
  await page.getByRole('button', { name: guolu!.name, exact: true }).last().click();
  const picker = page.locator('.fixed.z-\\[201\\]').last();
  await expect(picker).toBeVisible({ timeout: 10_000 });
  await picker.getByRole('button', { name: new RegExp(other!.name) }).first().click();

  // 先确认这一半真的成了 —— 不然下面那条断言分不清是"没改钉"还是"面板没跟"。
  await expect
    .poll(
      async () => {
        const map = await (await request.get(`${API}/api/projects/threads`)).json();
        return map[threadId] ?? null;
      },
      { timeout: 20_000, intervals: [1000] },
    )
    .toBe(other!.id);

  // 真正会坏的不是页签列表 —— 那个本来就会跟着换(每次取数都由服务端按钉定
  // 解析作用域)。坏的是**当前选中的那张表**:它还指着旧作用域里的 sheet,
  // 于是格子里显示的是一张已经不在页签里的表的数据。
  // (第一版断言写成"页签集合相等",退回修复照样绿 —— 等于没测。)
  const after = (
    await (await request.get(`${API}/api/table/sheets?threadId=${threadId}`)).json()
  ).sheets as Array<{ name: string }>;
  const names = new Set(after.map((sheet) => sheet.name));

  await expect
    .poll(
      async () => {
        // 选中的那个页签有 bg-primary;旧表不在新作用域里时,一个都不会亮。
        const active = await page
          .locator('[data-testid=sheet-tabs] .group\\/tab.bg-primary')
          .allInnerTexts();
        return active.map((t) => t.trim().replace(/\s+/g, '')).join('|');
      },
      { timeout: 30_000, intervals: [1000] },
    )
    .toMatch(new RegExp([...names].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')));
});

/**
 * **PDF 那两条今天发出去、却一次都没真跑过的路**:
 * 上下文卡片的封面,和文档面板里按页渲染。
 *
 * 判据要看到**画出来的像素**:卡片里得有一张 img,文档面板里也得有。
 * 只断言"没报错"会把"封面永远是空白"放过去 —— 那正是它最可能坏的样子。
 */
test('PDF:卡片出封面,文档面板画得出第一页', async ({ page, request }) => {
  const folder = await makeFixtureFolder();
  const name = `PDF 边界-${Date.now()}`;

  const created = await request.post(`${API}/api/projects`, { data: { name, sources: [] } });
  const project = (await created.json()).project as { id: string };
  await request.patch(`${API}/api/projects/${project.id}`, { data: { folder } });

  await page.goto('/');
  await openSidebar(page);
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 });

  // 卡片封面:滚到跟前才取,所以先让它进视野
  const card = page.getByRole('button', { name: new RegExp(PDF_NAME) }).first();
  await expect(card, 'PDF 没有单独的卡片(被折叠了?)').toBeVisible({ timeout: 20_000 });
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('img'), '卡片上没有封面 —— 封面那段代码等于白写')
    .toBeVisible({ timeout: 30_000 });

  // 文档面板:点开这份 PDF,要真画出第一页
  await card.click();
  const pageImage = page.locator('img[alt*="第 1 页"], img[alt*="page 1"]').first();
  await expect(pageImage, '文档面板没把第 1 页画出来').toBeVisible({ timeout: 60_000 });
});

/**
 * **没绑文件夹的项目**:让 agent 去读项目文件,它得说清"没有文件夹",
 * 而不是编一个、也不是抛一句看不懂的错误。
 *
 * 这是每个新项目的第一状态,却最容易没人测:拒绝话术写在工具里,可从来没人
 * 真让它走一遍。判据不看措辞,看**它有没有去编内容**。
 */
test('没绑文件夹时,读项目文件要说清没有文件夹', async ({ page, request }) => {
  const name = `没有文件夹-${Date.now()}`;
  const created = await request.post(`${API}/api/projects`, { data: { name, sources: [] } });
  expect((await created.json()).ok, '项目没建出来').toBeTruthy();

  await page.goto('/');
  await openSidebar(page);
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 });

  const composer = page.locator('textarea:visible').first();
  await composer.click();
  await page.waitForTimeout(2500);
  await composer.fill('读一下项目文件夹里的 开发组件.xlsx,告诉我里面有几行。');
  await composer.press('Enter');
  const reply = await waitForAssistantText(page, 1);

  expect(reply.length, '一句话都没答上').toBeGreaterThan(0);
  // 说清"没有文件夹 / 没绑 / 读不到" —— 任一说法都行,含糊其辞不行。
  // **中英文都认**:这套栈默认英文,模型经常用英文回答;把判据绑在语言上,
  // 测的就成了"它说哪国话",而不是"它说清楚了没有"(实测栽过一次)。
  expect(reply, `没说清为什么读不到:${reply.slice(0, 200)}`)
    .toMatch(/文件夹|绑定|读不到|不存在|folder|not (attached|bound|readable|available)/i);
  // **不许编**:项目里根本没有这个文件,却报出一个行数,那是最坏的一种回答。
  expect(reply, `编了行数:${reply.slice(0, 200)}`).not.toMatch(/共\s*\d+\s*行|一共\s*\d+\s*行/);
});

/**
 * **答到一半刷新页面,那一轮要能接上。**
 *
 * resume 存在的全部意义就是这个。跑测试时一直能看到一句
 * `TypeError: ... (reading 'state')` 落在 resumeStream 这条路上,被我们的 catch
 * 吞掉 —— 光看日志分不清那是"无害噪音"还是"恢复其实从来没成功过"。
 * 那就别猜:真刷新一次,看那一轮最后有没有落地。
 *
 * **同一个问题的基线是 198 字**(把 reload 那行注掉量的)。修之前刷新后只剩 19 字,
 * 而且开头重复。已经查实并修掉两处:
 *  · **卸载时主动掐流**:pagehide/beforeunload 里 POST /stop —— 而"刷新"恰恰是
 *    可恢复流存在的全部理由,一边掐一边恢复,两个功能互相抵消。(19 → 85 字)
 *  · **两处 `pipe(reply.raw)`**:socket 一关,pipe 把源一起销毁 —— 主流程里源是
 *    正在生成的这一轮,恢复端点里源是可恢复缓冲的读取游标。改成自己泵、
 *    客户端没了就只读不写。(开头重复消失)
 *
 * **服务端这一侧已经查实是好的**(打点量过):整轮 SSE 完整落进可恢复缓冲
 * (5315 字符),重连时也一字不落地写回给了客户端(sent=5646, dropped=0)。
 *
 * **还没修完,剩下的在客户端:它自己把这条恢复连接提前关了。**
 * 单条恢复连接下实测:服务端 sent=909、dropped=3641 —— 客户端读到约 900 字节
 * 就断,剩下三千多字节根本没被读走。下一刀从"谁 abort 了这条流"切
 * (嫌疑:wrapTrackedStream 的活性看门狗,或 SDK 把重放当成已结束)。
 *
 * 排查途中拆掉了一个**测试环境自己制造的假象**:隔离栈从前给 vite 传
 * VITE_API_URL,而 VITE_ 前缀会注入浏览器,api-base.ts 见到它就装上
 * "失败换地址重发"的 shim —— 于是一次逻辑请求变成两次 HTTP,重复文本和
 * "两次恢复"都由此而来,真实 dev(走代理、不设该变量)并没有这条路。
 * 现在改用 E2E_API_URL,只给代理看。
 */
test('答到一半刷新,那一轮还能接上', async ({ page, request }) => {
  // **已知未修完**(65/198)。钉在这里:修好了它会自己变绿并报警。
  test.fail();
  const name = `刷新恢复-${Date.now()}`;
  await request.post(`${API}/api/projects`, { data: { name, sources: [] } });

  await page.goto('/');
  await openSidebar(page);
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 });

  const composer = page.locator('textarea:visible').first();
  await composer.click();
  await page.waitForTimeout(2500);
  await composer.fill('用大约五句话讲讲车间排产里"瓶颈"是什么意思。');
  await composer.press('Enter');

  // 等它真的开口(有正文了),再在流中途刷新。
  await expect(page.locator('[data-role=assistant], .aui-assistant-message').first())
    .not.toBeEmpty({ timeout: 60_000 });
  await page.reload();

  // 刷新之后:这一轮的回答要在页面上,而且**不是半句**。
  const threadId = await latestThreadId(request);
  await expect
    .poll(
      async () => {
        const history = (await (
          await request.get(`${API}/api/threads/${threadId}/messages`)
        ).json()) as { messages?: Array<{ role?: string; parts?: Array<{ type?: string; text?: string }> }> };
        const last = (history.messages ?? []).filter((m) => m.role === 'assistant').at(-1);
        return (last?.parts ?? [])
          .filter((p) => p.type === 'text')
          .map((p) => p.text ?? '')
          .join('')
          .length;
      },
      { timeout: 3 * 60_000, intervals: [3000] },
    )
    // 同样的问题不刷新时基线约 200 字。阈值放在 120:低于它就说明刷新吃掉了
    // 一大半 —— 第一版写 20,48 字都能"通过",等于没测。
    .toBeGreaterThan(120);
});

declare global {
  interface Window {
    __veylinTest?: { openTablePanel?: () => void };
  }
}

/**
 * **预览里直接"导入到表格面板"。**
 *
 * 用户原话:中间能点开预览、右侧却打不开,能不能预览完直接选右侧打开。
 * 对表格来说,"打开"的正确含义不是再看一遍概览,而是**把它变成表格面板里那张
 * 能筛选、统计、被 table_query 用的表** —— agent 侧早有 table_import_file,
 * 人这条路一直缺着。
 */
test('预览里能把表格直接导进表格面板', async ({ page, request }) => {
  const folder = await makeFixtureFolder();
  const name = `预览导入-${Date.now()}`;
  await request.post(`${API}/api/projects`, { data: { name, sources: [] } });

  await page.goto('/');
  await openSidebar(page);
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 });

  const composer = page.locator('textarea:visible').first();
  await composer.click();
  await page.waitForTimeout(2500);
  // 先说一句进对话:预览浮层要量聊天区的尺寸,项目页上量不到就整个不渲染
  // (实测:在项目页点附件没有任何反应)。
  await composer.fill('说一句知道了就行。');
  await composer.press('Enter');
  await waitForAssistantText(page, 1);

  const chatComposer = page.locator('textarea:visible').first();
  await chatComposer.click();
  await page.waitForTimeout(1000);
  await dropFile(page, join(folder, XLSX_NAME), XLSX_NAME);

  // 点文件名打开预览。外层那个触发器是 display:contents —— 没有盒子,
  // Playwright 判为不可见、点不到(踩过)。
  await page.getByText(XLSX_NAME, { exact: false }).locator('visible=true').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });

  await dialog.getByRole('button', { name: '导入到表格面板' }).click();

  // 导完要**带过去**:面板打开,而且新表就是当前这张(名字取自文件名)。
  const sheetName = XLSX_NAME.replace(/\.[^.]+$/, '');
  await expect(page.locator('[data-panel-kind=table]')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () => (await page
        .locator('[data-testid=sheet-tabs] .group\\/tab.bg-primary')
        .allInnerTexts()).join('').replace(/\s+/g, ''),
      { timeout: 30_000, intervals: [1000] },
    )
    .toContain(sheetName);

  // 真有数据才算导进来了 —— 只看到一个页签不算。
  const threadId = await latestThreadId(request);
  const sheets = (
    await (await request.get(`${API}/api/table/sheets?threadId=${threadId}`)).json()
  ).sheets as Array<{ id: string; name: string }>;
  const sheet = sheets.find((s) => s.name === sheetName);
  expect(sheet, `没建出「${sheetName}」这张表`).toBeTruthy();
  const data = await (
    await request.get(
      `${API}/api/table?sheet=${encodeURIComponent(sheet!.id)}&threadId=${threadId}`,
    )
  ).json();
  expect((data.rows as unknown[]).length, '导进来的表是空的').toBeGreaterThan(0);
});
