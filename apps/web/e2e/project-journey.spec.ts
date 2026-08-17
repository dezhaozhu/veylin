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

/** 打开右侧的表格面板(右栏收起时先展开)。 */
async function openTablePanel(page: Page): Promise<void> {
  const tableTab = page.getByRole('button', { name: 'Table' }).first();
  if (((await tableTab.boundingBox().catch(() => null))?.x ?? 0) <= 0) {
    const toggles = await page.getByRole('button', { name: 'Toggle Sidebar' }).all();
    const boxes = await Promise.all(
      toggles.map(async (t) => [t, (await t.boundingBox())?.x ?? -1] as const),
    );
    // 右栏展开后自己还有一个 toggle,坐标在视口外 —— 用**真实视口宽度**过滤,
    // 别写死(写死过 1280,视口一改就把该点的那个排除了)。
    const width = page.viewportSize()?.width ?? 1280;
    const inView = boxes.filter(([, x]) => x > 0 && x < width).sort((a, b) => b[1] - a[1]);
    if (inView[0]) await inView[0][0].click();
    await page.waitForTimeout(1200);
  }
  await tableTab.click();
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
