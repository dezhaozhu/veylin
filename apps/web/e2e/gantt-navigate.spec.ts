/**
 * **卡片点条 → 右侧甘特定位**,像用户那样点一遍。
 *
 * 为什么非得真跑:这条链路跨三道墙 —— Compass 的 widget(沙箱 iframe)、宿主的
 * 动作桥(只认自己子树里的 iframe + 真实点击手势)、右栏面板(拉开抽屉、开页签、
 * 等 dhtmlx 实例建好再选中)。单测只能各测一段;「iframe 里的一次点击能不能穿过
 * 桥、把右栏拉开并选中同一道作业」只有真浏览器里点才知道。第一版 widget 就是在
 * 真浏览器里才暴露出「脚本加载即 ReferenceError、整图不画」(单测全绿)。
 *
 * 跑法(整栈隔离,不碰用户在用的 :8787 和真实数据):
 *   npx playwright test -c playwright.isolated.config.ts gantt-navigate
 */
import { expect, test, type APIRequestContext, type Frame, type Page } from '@playwright/test';

const API = `http://127.0.0.1:${process.env.E2E_API_PORT ?? '8799'}`;

type Project = { id: string; name: string; sources: string[] };

/**
 * 等 Compass 场景物化成项目(身份同步是异步的;新数据目录里第一次要等一会)。
 * **固定选上重**:判据依赖它的数据形状(驾驶舱是积压脸、有「在甘特里看」;资源视角
 * 里有 J0炉 这条泳道)。此前写成「锅炉厂或上重谁先来」,一轮选到锅炉厂就两条红
 * (锅炉厂是 data_trust 脸、没有 J0炉)——那是夹具在抖,不是产品。
 */
async function compassProject(request: APIRequestContext): Promise<Project> {
  let found: Project | undefined;
  await expect
    .poll(
      async () => {
        const listed = await (await request.get(`${API}/api/projects`)).json();
        found = (listed.projects as Project[]).find((p) => p.sources.includes('shangzhong'));
        return Boolean(found);
      },
      { timeout: 90_000, intervals: [2000] },
    )
    .toBe(true);
  return found!;
}

async function openSidebar(page: Page): Promise<void> {
  const newProject = page.getByRole('button', { name: 'New project' }).first();
  if (((await newProject.boundingBox())?.x ?? -1) < 0) {
    await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click();
    await expect.poll(async () => (await newProject.boundingBox())?.x ?? -1).toBeGreaterThan(0);
  }
}

/** 找到画着甘特条的那个 widget iframe(对话里可能还有别的沙箱 iframe)。 */
async function widgetFrameWithBars(page: Page): Promise<Frame> {
  let hit: Frame | undefined;
  await expect
    .poll(
      async () => {
        for (const f of page.frames()) {
          if (f === page.mainFrame()) continue;
          try {
            if ((await f.locator('rect.bar[data-job]').count()) > 0) {
              hit = f;
              return true;
            }
          } catch {
            /* frame 正在换页,下一轮再看 */
          }
        }
        return false;
      },
      { timeout: 6 * 60_000, intervals: [3000] },
    )
    .toBe(true);
  return hit!;
}

test('内联甘特点一根条 → 右栏甘特打开并选中同一道作业', async ({ page, request }) => {
  const project = await compassProject(request);

  await page.goto('/');
  await openSidebar(page);
  // 走项目页那个输入框:侧栏的「新对话」只建线程、不跳转,进不了对话页。
  await page.getByText(project.name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible({ timeout: 15_000 });

  const composer = page.locator('textarea:visible').first();
  await composer.click();
  await page.waitForTimeout(2500);
  // 让模型真调 get_gantt。措辞点名工具,不给它「用文字描述一下」的余地。
  await composer.fill('用 get_gantt 工具画一下最近 60 天工作中心视角的排产甘特图,直接画,不用解释。');
  await composer.press('Enter');

  // 判据 1:对话里真的出现了带条的甘特 widget(不是模型嘴上说画了)。
  const frame = await widgetFrameWithBars(page);
  const bar = frame.locator('rect.bar[data-job]').first();
  const jobId = await bar.getAttribute('data-job');
  expect(jobId, '条上没有作业号').toBeTruthy();

  // 点之前右栏不该已经有甘特页签 —— 否则「点了之后有」不说明什么。
  const before = await page.evaluate(() =>
    (window as unknown as { __veylinTest: { panelState: () => { tabs: Array<{ kind: string }> } } })
      .__veylinTest.panelState(),
  );
  expect(before.tabs.some((t) => t.kind === 'gantt'), '点之前甘特页签就已经开着').toBe(false);

  // 真点(iframe 里的一次 click 会把用户激活传给宿主,桥才受理)。
  await bar.scrollIntoViewIfNeeded();
  await bar.click();

  // 判据 2:右栏开了甘特页签并且是活动页签。
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const s = (window as unknown as {
            __veylinTest: { panelState: () => { tabs: Array<{ id: string; kind: string }>; activeId: string | null } };
          }).__veylinTest.panelState();
          const g = s.tabs.find((t) => t.kind === 'gantt');
          return g ? (s.activeId === g.id ? 'active' : 'open-not-active') : 'none';
        }),
      { timeout: 30_000, intervals: [500] },
    )
    .toBe('active');

  // 判据 3:面板里选中的就是点的那一道(dhtmlx 任务 id = `job:<作业号>`),
  // 不是随便滚到一条。找不到时面板的约定是「不动」,那这里就会红 —— 正好。
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const sel = document.querySelector('.gantt_task_line.gantt_selected, .gantt_row.gantt_selected');
          return sel?.getAttribute('data-task-id') ?? sel?.getAttribute('task_id') ?? null;
        }),
      { timeout: 60_000, intervals: [1000] },
    )
    .toBe(`job:${jobId}`);
});

/**
 * **agent 自己导航**:模型调 `navigate` 工具 → 客户端拿到刚发出的结果 → 走和
 * 卡片点条同一个 handler。判据不看它嘴上说什么:工具结果里的锚点 = 面板里真选中
 * 的那一道。
 */
test('agent 调 navigate 工具 → 右栏甘特定位到它说的那道作业', async ({ page, request }) => {
  const project = await compassProject(request);

  await page.goto('/');
  await openSidebar(page);
  await page.getByText(project.name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible({ timeout: 15_000 });

  const composer = page.locator('textarea:visible').first();
  await composer.click();
  await page.waitForTimeout(2500);
  await composer.fill(
    '先用 get_gantt 画最近 60 天工作中心视角的甘特(days=60, view=resource),然后用 navigate 工具(kind=job)把右侧甘特定位到结果里第一根条的 job_id。两个工具都要真的调用。',
  );
  await composer.press('Enter');

  // 判据 1:历史里真有一条 ok 的 navigate 工具结果,拿它说的锚点当基准。
  let anchorId = '';
  await expect
    .poll(
      async () => {
        const threads = (await (await request.get(`${API}/api/threads`)).json()).threads as Array<{ remoteId?: string; id?: string }>;
        const tid = threads[0]?.remoteId ?? threads[0]?.id;
        if (!tid) return false;
        const msgs = (await (await request.get(`${API}/api/threads/${tid}/messages`)).json()) as
          | Array<{ parts?: Array<Record<string, unknown>> }>
          | { messages: Array<{ parts?: Array<Record<string, unknown>> }> };
        const list = Array.isArray(msgs) ? msgs : msgs.messages;
        for (const m of list) {
          for (const p of m.parts ?? []) {
            if (p.type !== 'tool-navigate') continue;
            const out = (p.output ?? p.result) as { ok?: boolean; anchor?: { kind?: string; id?: string } } | undefined;
            if (out?.ok && out.anchor?.kind === 'job' && out.anchor.id) {
              anchorId = out.anchor.id;
              return true;
            }
          }
        }
        return false;
      },
      { timeout: 6 * 60_000, intervals: [3000] },
    )
    .toBe(true);

  // 判据 2:右栏甘特是活动页签。
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const s = (window as unknown as {
            __veylinTest: { panelState: () => { tabs: Array<{ id: string; kind: string }>; activeId: string | null } };
          }).__veylinTest.panelState();
          const g = s.tabs.find((t) => t.kind === 'gantt');
          return g ? (s.activeId === g.id ? 'active' : 'open-not-active') : 'none';
        }),
      { timeout: 30_000, intervals: [500] },
    )
    .toBe('active');

  // 判据 3:选中的正是工具结果里那道作业。
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const sel = document.querySelector('.gantt_task_line.gantt_selected, .gantt_row.gantt_selected');
          return sel?.getAttribute('data-task-id') ?? sel?.getAttribute('task_id') ?? null;
        }),
      { timeout: 60_000, intervals: [1000] },
    )
    .toBe(`job:${anchorId}`);
});

/**
 * **驾驶舱「在甘特里看」**:cockpit 卡片的 get_gantt 钻取 → navigate(kind=view)
 * → 右栏甘特打开。判据只到「甘特页签活动」:视角锚点不选中任何一道,面板按约定不乱滚。
 */
test('驾驶舱点「在甘特里看」→ 右栏甘特打开', async ({ page, request }) => {
  const project = await compassProject(request);

  await page.goto('/');
  await openSidebar(page);
  await page.getByText(project.name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible({ timeout: 15_000 });

  const composer = page.locator('textarea:visible').first();
  await composer.click();
  await page.waitForTimeout(2500);
  await composer.fill('用 get_cockpit 工具看一下现在的排产驾驶舱,直接调工具,不用解释。');
  await composer.press('Enter');

  // 找到画着驾驶舱、带「在甘特里看」钻取按钮的那个 widget iframe。
  let frame: Frame | undefined;
  await expect
    .poll(
      async () => {
        for (const f of page.frames()) {
          if (f === page.mainFrame()) continue;
          try {
            if ((await f.locator('[data-drill="get_gantt"]').count()) > 0) {
              frame = f;
              return true;
            }
          } catch {
            /* frame 正在换页 */
          }
        }
        return false;
      },
      { timeout: 6 * 60_000, intervals: [3000] },
    )
    .toBe(true);

  const drill = frame!.locator('[data-drill="get_gantt"]').first();
  await drill.scrollIntoViewIfNeeded();
  await drill.click();

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const s = (window as unknown as {
            __veylinTest: { panelState: () => { tabs: Array<{ id: string; kind: string }>; activeId: string | null } };
          }).__veylinTest.panelState();
          const g = s.tabs.find((t) => t.kind === 'gantt');
          return g ? (s.activeId === g.id ? 'active' : 'open-not-active') : 'none';
        }),
      { timeout: 30_000, intervals: [500] },
    )
    .toBe('active');

  // 判据 2:资源锚点要么落到一条泳道(高亮的是泳道父行 `lane:…`,不是某道作业),
  // 要么面板如实说「不在排产模型的泳道里」。两者必居其一;静默什么都不做 = 红。
  const anchorId = await drill.getAttribute('data-anchor');
  expect(anchorId, '钻取按钮没带锚点').toBeTruthy();
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const note = document.querySelector('[data-testid="gantt-lane-not-in-model"]');
          if (note) return `note:${note.textContent?.slice(0, 20)}`;
          const sel = document.querySelector('.gantt_task_line.gantt_selected, .gantt_row.gantt_selected');
          const id = sel?.getAttribute('data-task-id') ?? sel?.getAttribute('task_id') ?? '';
          return id.startsWith('lane:') ? `lane:${id.slice(5)}` : null;
        }),
      { timeout: 60_000, intervals: [1000] },
    )
    .toMatch(/^(note:|lane:)/);
});

/**
 * **资源锚点·找得到的那条路**:驾驶舱的鼓多半是三级工作中心(二级模型里没泳道),
 * 上一条走的是「如实说没有」;这条让 agent 直接 navigate 到一个**真在模型里**的资源
 * (J0炉),判据=甘特按资源视角打开、高亮的是 `lane:J0炉` 这条泳道父行(不是某道作业)。
 */
test('agent navigate kind=resource → 甘特翻到那条泳道并高亮泳道本身', async ({ page, request }) => {
  const project = await compassProject(request);

  await page.goto('/');
  await openSidebar(page);
  await page.getByText(project.name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible({ timeout: 15_000 });

  const composer = page.locator('textarea:visible').first();
  await composer.click();
  await page.waitForTimeout(2500);
  await composer.fill('直接调用 navigate 工具,参数 kind=resource、id=J0炉、surface=gantt,把右侧甘特定位到 J0炉 这条泳道。不要调别的工具,不用解释。');
  await composer.press('Enter');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const s = (window as unknown as {
            __veylinTest: { panelState: () => { tabs: Array<{ id: string; kind: string }>; activeId: string | null } };
          }).__veylinTest.panelState();
          const g = s.tabs.find((t) => t.kind === 'gantt');
          return g ? (s.activeId === g.id ? 'active' : 'open-not-active') : 'none';
        }),
      { timeout: 4 * 60_000, intervals: [1000] },
    )
    .toBe('active');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const sel = document.querySelector('.gantt_task_line.gantt_selected, .gantt_row.gantt_selected');
          return sel?.getAttribute('data-task-id') ?? sel?.getAttribute('task_id') ?? null;
        }),
      { timeout: 60_000, intervals: [1000] },
    )
    .toBe('lane:J0炉');
  // 找到了就不该出「不在模型里」那句
  expect(await page.locator('[data-testid="gantt-lane-not-in-model"]').count()).toBe(0);
});

/**
 * **跨面版本不一致要说出来(#6)**:表格是导入那一刻的排产,中间 Compass 又排了一次,
 * 甘特是新的。从甘特点一根条落到表格时,表格顶部必须出「表格还是 X 那版排产」横幅。
 * 制造不一致的办法是真的让 Compass 重排一次(上重贪心 ~40s),没有 mock。
 */
test('表格导入后 Compass 重排 → 甘特点条落到表格 → 版本不一致横幅', async ({ page, request }) => {
  const project = await compassProject(request);

  await page.goto('/');
  await openSidebar(page);
  await page.getByText(project.name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible({ timeout: 15_000 });
  const composer = page.locator('textarea:visible').first();
  await composer.click();
  await page.waitForTimeout(2500);

  // 拿到这条线程并等它钉到项目(点输入框会异步建线程+钉项目)。
  let threadId = '';
  await expect
    .poll(
      async () => {
        const body = await (await request.get(`${API}/api/threads`)).json();
        const first = (body.threads as Array<{ remoteId?: string; id?: string }>)[0];
        threadId = first?.remoteId ?? first?.id ?? '';
        if (!threadId) return false;
        const map = await (await request.get(`${API}/api/projects/threads`)).json();
        return (map.threads?.[threadId] ?? map[threadId]) === project.id;
      },
      { timeout: 30_000, intervals: [1000] },
    )
    .toBe(true);

  // 1) **先把表格面板打开**,让它自己把排产表导进来并盖上当前的 run_id(版本 A)。
  //    表格面板一挂载就会重导 Compass(bootstrap),所以「先导入、后开面板」造不出
  //    不一致 —— 上一版用例就是这么白跑了两轮(trace 里看到面板挂载后又 POST 了两次
  //    load-compass-schedule,把版本盖回了最新)。真实场景正是面板一直开着、中间重排。
  await page.evaluate(() => (window as unknown as { __veylinTest: { openTablePanel: () => void } }).__veylinTest.openTablePanel());
  let stamped = '';
  await expect
    .poll(
      async () => {
        const sheets = (await (await request.get(`${API}/api/table/sheets?threadId=${threadId}`)).json()).sheets as Array<{ source?: { runId?: string } }>;
        stamped = sheets.find((s) => s.source?.runId)?.source?.runId ?? '';
        return Boolean(stamped);
      },
      { timeout: 120_000, intervals: [2000] },
    )
    .toBe(true);
  // 等表格把行拉完,别让后面的重排和它的分页拉取撞在一起。
  await page.waitForTimeout(8000);

  // 2) 让 Compass 真的再排一次(版本 B)。身份与隔离栈同一份(.env 里的 identity)。
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const env = readFileSync(resolve(process.cwd(), '../../.env'), 'utf8');
  const identity = JSON.parse(/VEYLIN_COMPASS_IDENTITY='(.+)'/.exec(env)![1]!) as { url: string; token: string };
  const res = await request.post(`${identity.url}/mcp/`, {
    headers: { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'x-compass-source': 'shangzhong' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'reschedule', arguments: {} } },
    timeout: 300_000,
  });
  const line = (await res.text()).split('\n').find((l) => l.startsWith('data: '))!;
  const newRun = JSON.parse(JSON.parse(line.slice(6)).result.content[0].text).run_id as string;
  expect(newRun, '重排没产生新 run').toBeTruthy();
  expect(newRun).not.toBe(stamped);

  // 3) 打开甘特(新版本)。
  await composer.fill('直接调用 navigate 工具,参数 kind=view、id=resource、surface=gantt,打开右侧甘特。不要调别的工具,不用解释。');
  await composer.press('Enter');
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const s = (window as unknown as { __veylinTest: { panelState: () => { tabs: Array<{ id: string; kind: string }>; activeId: string | null } } }).__veylinTest.panelState();
          const g = s.tabs.find((t) => t.kind === 'gantt');
          return g ? (s.activeId === g.id ? 'active' : 'open-not-active') : 'none';
        }),
      { timeout: 4 * 60_000, intervals: [1000] },
    )
    .toBe('active');

  // 4) 甘特点一根条 → 落到表格,表格顶部要有版本横幅,且提到新版本的时间。
  const bar = page.locator('.gantt_task_line[data-task-id^="job:"]').first();
  await expect(bar).toBeVisible({ timeout: 60_000 });
  await bar.click();
  await expect(page.getByTestId('table-run-mismatch')).toBeVisible({ timeout: 60_000 });
  const m = /(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(newRun)!;
  await expect(page.getByTestId('table-run-mismatch')).toContainText(`${m[1]}-${m[2]} ${m[3]}:${m[4]}`);
});

/**
 * **订单双落地(surface=both)**:一张单同时落在表格与甘特上,而且两张地图**同屏**
 * (不在同一 pane 就分屏)。判据只看结构:panelState 里 gantt 与 table 分属上下两个
 * pane 且都是各自 pane 的可见页;几何不进判据。
 */
test('agent navigate kind=order surface=both → 表格与甘特分屏同屏', async ({ page, request }) => {
  const project = await compassProject(request);

  await page.goto('/');
  await openSidebar(page);
  await page.getByText(project.name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible({ timeout: 15_000 });

  const composer = page.locator('textarea:visible').first();
  await composer.click();
  await page.waitForTimeout(2500);
  await composer.fill(
    '先用 get_schedule_rows(limit=5)拿几行,然后直接调用 navigate 工具,参数 kind=order、id=第一行的 order_id、surface=both,把那张订单同时定位到右侧表格与甘特。两个工具都要真的调用,不用解释。',
  );
  await composer.press('Enter');

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const s = (window as unknown as {
            __veylinTest: {
              panelState: () => {
                tabs: Array<{ id: string; kind: string }>;
                split: { bottomIds: string[]; topVisibleId: string; bottomVisibleId: string } | undefined;
              };
            };
          }).__veylinTest.panelState();
          const g = s.tabs.find((t) => t.kind === 'gantt');
          const tb = s.tabs.find((t) => t.kind === 'table');
          if (!g || !tb) return `missing:${g ? '' : 'gantt '}${tb ? '' : 'table'}`;
          if (!s.split) return 'no-split';
          const visible = new Set([s.split.topVisibleId, s.split.bottomVisibleId]);
          const gBottom = s.split.bottomIds.includes(g.id);
          const tBottom = s.split.bottomIds.includes(tb.id);
          if (gBottom === tBottom) return 'same-pane';
          return visible.has(g.id) && visible.has(tb.id) ? 'both-visible' : 'split-but-hidden';
        }),
      { timeout: 4 * 60_000, intervals: [1000] },
    )
    .toBe('both-visible');
});


/** 进项目后先让首个线程建出来并钉到项目上(甘特/表格都按线程钉的项目取数;没钉是 409)。 */
async function pinnedThread(page: Page, request: APIRequestContext, projectId: string): Promise<string> {
  const composer = page.locator('textarea:visible').first();
  await composer.click();
  await page.waitForTimeout(2500);
  let threadId = '';
  await expect
    .poll(
      async () => {
        const body = await (await request.get(`${API}/api/threads`)).json();
        const first = (body.threads as Array<{ remoteId?: string; id?: string }>)[0];
        threadId = first?.remoteId ?? first?.id ?? '';
        if (!threadId) return false;
        const map = await (await request.get(`${API}/api/projects/threads`)).json();
        return (map.threads?.[threadId] ?? map[threadId]) === projectId;
      },
      { timeout: 30_000, intervals: [1000] },
    )
    .toBe(true);
  return threadId;
}

/**
 * **规则 → 它管到的作业**(宿主机制,不经模型):打开表格拿到一个真实段码,然后喂
 * 一个 rule 锚点给和 agent navigate 同一个 handler。判据:网格里露出来的期量工序列
 * 全等于那个段码,且行数比过滤前少(过滤是等值,不是装样子)。
 */
test('rule 锚点 → 排产表按作用域等值过滤', async ({ page, request }) => {
  const project = await compassProject(request);

  await page.goto('/');
  await openSidebar(page);
  await page.getByText(project.name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible({ timeout: 15_000 });

  const threadId = await pinnedThread(page, request, project.id);
  await page.evaluate(() => (window as unknown as { __veylinTest: { openTablePanel: () => void } }).__veylinTest.openTablePanel());
  // 表格自举会把 Compass 排产灌进来并盖 runId;等它落地再读格子
  await expect
    .poll(
      async () => {
        const sheets = (await (await request.get(`${API}/api/table/sheets?threadId=${threadId}`)).json()).sheets as Array<{ source?: { runId?: string } }>;
        return Boolean(sheets.find((sh) => sh.source?.runId));
      },
      { timeout: 120_000, intervals: [2000] },
    )
    .toBe(true);
  const stageCells = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('.ag-cell[col-id="stage_code"]')).map((c) => c.textContent?.trim() ?? ''),
    );
  await expect.poll(async () => (await stageCells()).filter(Boolean).length, { timeout: 90_000, intervals: [1000] }).toBeGreaterThan(1);
  const before = (await stageCells()).filter(Boolean);
  const distinct = Array.from(new Set(before));
  expect(distinct.length).toBeGreaterThan(1);   // 有得过滤才算数
  const stage = distinct[0];

  await page.evaluate(
    (st) => (window as unknown as { __veylinTest: { navigate: (t: unknown) => void } }).__veylinTest.navigate({ kind: 'rule', id: 'r-e2e', stageCode: st, surface: 'grid' }),
    stage,
  );

  await expect
    .poll(async () => {
      const cells = (await stageCells()).filter(Boolean);
      return cells.length === 0 ? 'no-rows' : Array.from(new Set(cells)).join('|');
    }, { timeout: 60_000, intervals: [1000] })
    .toBe(stage);
  // 行数不当判据:AG-Grid 只渲染视口内的行,过滤前后 DOM 里都只有十来行。
  // 「过滤前多种段码、过滤后只剩这一种」已经证明过滤真的作用在了行上。
});

/**
 * **三级 → 展开它那条二级**(宿主机制,不经模型):从 /api/gantt/window 拿一根
 * 有三级的二级条,展开取它第一道三级的工单号,然后喂 job+op 锚点。判据:甘特里
 * 选中的 task id 正是 `wo:<job>:<op>` —— 二级被展开、三级子行被选中。
 */
test('job+op 锚点 → 甘特展开二级并选中三级子行', async ({ page, request }) => {
  const project = await compassProject(request);

  await page.goto('/');
  await openSidebar(page);
  await page.getByText(project.name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible({ timeout: 15_000 });

  const threadId = await pinnedThread(page, request, project.id);
  // 甘特面板按**客户端**线程 id 取数,而它要到首轮对话回来后才知道自己的远端 id
  // (钉项目是按远端 id 记的;没它服务端落到个人区,窗是空的 —— 真跑抓的)。
  const composer = page.locator('textarea:visible').first();
  await composer.fill('你好');
  await composer.press('Enter');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __veylinTest: { threadId: () => string | undefined } }).__veylinTest.threadId() ?? ''), { timeout: 120_000, intervals: [1000] })
    .toBe(threadId);

  const picked = await page.evaluate(async (tid) => {
    const win = await (await fetch(`/api/gantt/window?view=resource&threadId=${encodeURIComponent(tid)}&lane_limit=200`)).json();
    type Bar = { job_id: string; order_id: string; has_children?: boolean };
    const bars: Bar[] = (win.lanes ?? []).flatMap((l: { bars?: Bar[] }) => l.bars ?? []);
    const bar = bars.find((b) => b.has_children);
    if (!bar) return null;
    const ex = await (await fetch(`/api/gantt/window?view=resource&threadId=${encodeURIComponent(tid)}&lane_limit=200&expand=${encodeURIComponent(bar.order_id)}`)).json();
    const bars2: Array<Bar & { children?: Array<{ _work_order_id?: string }> }> = (ex.lanes ?? []).flatMap((l: { bars?: Bar[] }) => l.bars ?? []);
    const same = bars2.find((b) => b.job_id === bar.job_id);
    const op = same?.children?.find((c) => c._work_order_id)?._work_order_id ?? null;
    return op ? { jobId: bar.job_id, orderId: bar.order_id, op } : { debug: { ok: win.ok, message: win.message, lanes: (win.lanes ?? []).length, bars: bars.length, withKids: bars.filter((b) => b.has_children).length } };
  }, threadId);
  expect(picked, `资源视角第一页里要有一根带三级的二级条: ${JSON.stringify(picked)}`).toHaveProperty('op');

  await page.evaluate(
    (t) => (window as unknown as { __veylinTest: { navigate: (x: unknown) => void } }).__veylinTest.navigate({ kind: 'job', id: t.jobId, orderId: t.orderId, op: t.op, surface: 'gantt' }),
    picked as { jobId: string; orderId: string; op: string },
  );

  // 判据带状态:失败时能看出卡在哪一步(甘特没开 / 二级条不在窗里 / 没展开 / 展开了没选中)。
  const want = `wo:${(picked as { jobId: string }).jobId}:${(picked as { op: string }).op}`;
  await expect
    .poll(
      async () =>
        page.evaluate((w) => {
          const s = (window as unknown as {
            __veylinTest: { panelState: () => { tabs: Array<{ id: string; kind: string }>; activeId: string | null } };
          }).__veylinTest.panelState();
          const g = s.tabs.find((t) => t.kind === 'gantt');
          if (!g) return 'no-gantt-tab';
          const jobId = w.slice(3, w.lastIndexOf(':'));
          const rows = Array.from(document.querySelectorAll('.gantt_row, .gantt_task_line')).map((r) => r.getAttribute('data-task-id') ?? r.getAttribute('task_id') ?? '');
          const containers = document.querySelectorAll('.gantt_container').length;
          const text = (document.querySelector('[data-panel-kind="gantt"], .gantt_container')?.parentElement?.textContent ?? document.body.innerText).slice(0, 160).replace(/\s+/g, ' ');
          const hasJob = rows.includes(`job:${jobId}`);
          const kids = rows.filter((r) => r.startsWith(`wo:${jobId}:`));
          const sel = document.querySelector('.gantt_task_line.gantt_selected, .gantt_row.gantt_selected');
          const selected = sel?.getAttribute('data-task-id') ?? sel?.getAttribute('task_id') ?? null;
          if (selected === w) return 'ok';
          const ids = (window as unknown as { __veylinTest: { ganttTaskIds: () => string[] } }).__veylinTest.ganttTaskIds();
          const expandReqs = performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/gantt/window') && e.name.includes('expand=')).length;
          const hook = (window as unknown as { __veylinTest: { ganttInstanceTask: (id: string) => unknown } }).__veylinTest;
          const instKid = JSON.stringify(hook.ganttInstanceTask(w));
          const instJob = JSON.stringify(hook.ganttInstanceTask(`job:${jobId}`));
          return `rows=${rows.length} job=${hasJob} kids=${kids.length} selected=${selected} tasks=${ids.length} wo=${ids.filter((i) => i.startsWith('wo:')).length} want=${ids.includes(w)} expandReqs=${expandReqs} instKid=${instKid} instJob=${instJob} containers=${containers} ${text.slice(0, 10)}`;
        }, want),
      { timeout: 2 * 60_000, intervals: [1000] },
    )
    .toBe('ok');
});
