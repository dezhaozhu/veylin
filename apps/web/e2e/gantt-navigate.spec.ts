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

/** 等 Compass 场景物化成项目(身份同步是异步的;新数据目录里第一次要等一会)。 */
async function compassProject(request: APIRequestContext): Promise<Project> {
  let found: Project | undefined;
  await expect
    .poll(
      async () => {
        const listed = await (await request.get(`${API}/api/projects`)).json();
        found = (listed.projects as Project[]).find((p) =>
          p.sources.some((s) => s === 'guolu' || s === 'shangzhong'),
        );
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
