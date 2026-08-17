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

  return dir;
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

  // 上下文改成卡片之后,**文件夹合成一张卡**(形状取自 Claude 的 Context 栏):
  // 卡上写清有几项,点进去才是具体哪几份。两层都要断言 —— 只看卡会漏掉
  // "点进去其实是空的",只看清单又测不到卡。
  await expect(page.getByText('3 项', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  const folderCard = page.getByRole('button', { name: /项$/ }).first();
  await expect(folderCard, '文件夹没有合成一张卡').toBeVisible({ timeout: 20_000 });
  await folderCard.click();

  for (const name of [XLSX_NAME, DOCX_NAME, PPTX_NAME]) {
    await expect(
      page.getByText(name, { exact: false }).first(),
      `点开文件夹卡之后仍然看不到 ${name}`,
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
 * 两道坎都是真几何,不是玄学:右栏可能整个收着(按钮 x<0);也可能开着、但被
 * 左侧栏挤到**视口右边之外**(实测 x=1660,视口 1600)—— 后者 Playwright 报的是
 * "outside of the viewport",force 也点不动。收起左侧栏就腾出来了。
 */
async function openTablePanel(page: Page): Promise<void> {
  const tableTab = page.getByRole('button', { name: 'Table' }).first();
  const width = page.viewportSize()?.width ?? 1280;
  const fits = async () => {
    const box = await tableTab.boundingBox().catch(() => null);
    return box != null && box.x > 0 && box.x + box.width <= width;
  };

  if (!(await fits())) {
    // 先把右栏展开(它自己那个 toggle 在视口外,只看视口内的)
    const toggles = await page.getByRole('button', { name: 'Toggle Sidebar' }).all();
    const boxes = await Promise.all(
      toggles.map(async (t) => [t, (await t.boundingBox())?.x ?? -1] as const),
    );
    const inView = boxes.filter(([, x]) => x > 0 && x < width).sort((a, b) => b[1] - a[1]);
    if (inView[0]) await inView[0][0].click();
    await page.waitForTimeout(1200);
  }
  if (!(await fits())) {
    // 还是放不下 —— 收起左侧栏腾地方。
    await page.getByRole('button', { name: /Close sidebar|Toggle Sidebar/ }).first().click();
    await page.waitForTimeout(1200);
  }
  await tableTab.click();
  await page.waitForTimeout(1500);
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
  // **必须是这一次导进来的那张**。第一版写成"任何一张没有 source 的表",
  // 结果被上一轮跑剩下的旧表蒙混过关:那一轮 agent 其实只建了个空壳,
  // 断言却是绿的 —— 弱断言和没测一样。
  const fromLocal = sheets.find((s) => s.name === XLSX_NAME.replace(/\.[^.]+$/, ''));
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
  await request.post(`${API}/api/table/load-compass-schedule`, { data: { threadId } });

  const sheets = (
    await (await request.get(`${API}/api/table/sheets?threadId=${threadId}`)).json()
  ).sheets as Array<{ id: string; name: string; source?: { server?: string } }>;
  const cloud = sheets.find((s) => s.source?.server === 'compass');
  test.skip(!cloud, '这个项目里没有云端表');

  await composer.fill('把项目文件夹里的 开发组件.xlsx 导入表格面板,建一张新表。');
  await composer.press('Enter');
  await waitForAssistantText(page, 1);

  await openTablePanel(page);
  await page.waitForTimeout(6000);

  const localName = XLSX_NAME.replace(/\.[^.]+$/, '');
  // 来回切三次,每次都要求"当前页签"和"屏幕上的列"对得上。
  for (const name of [cloud!.name, localName, cloud!.name, localName]) {
    await page.getByRole('button', { name, exact: true }).first().click();
    // 切表是异步的:等到这张表自己的列真的上了屏。
    const marker = name === localName ? '型号' : '订单号';
    await expect
      .poll(async () => (await page.locator('.ag-header-cell-text').allInnerTexts()).join('|'), {
        timeout: 60_000,
        intervals: [1000],
      })
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
