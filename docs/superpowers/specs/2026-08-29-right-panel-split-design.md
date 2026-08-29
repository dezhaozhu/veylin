# 右栏分屏（上下两 pane）设计

日期：2026-08-29 · 分支：feat/split-panel（基于 gitlab-main 7fbcc19）

## 动机

甘特↔表格的联动目前只能是「跳转」：右栏同一时刻只挂当前页签，点表格跳甘特
就是把表格藏起来。分屏把「跳转」在同屏时自动退化成「呼应」——而且这不是甘特
特例：工艺文档+表格、web+知识库、认知卡+表格全都受益。面板系统是注册表驱动
的（`PanelKindDef`），**八种面板内容组件一行不改**，分屏只动容器层。

## 范围（v1，克制）

- 右栏最多一分为二，**上下**分屏（甘特要横向时间轴、表格要行数，都吃宽度）。
- 手势：页签上悬停出一个「移到下方/移回上方」图标按钮（不做右键菜单——桌面端
  HTML 菜单会被原生 webview 盖住，「+」菜单为此专门走了原生菜单，v1 不复制
  这套复杂度）。分隔线可拖，比例持久化。
- 下 pane 关掉最后一个页签 → 分屏自动解除。
- 不做：左右分屏、三分屏、跨 pane 拖拽页签排序、agent 指定 pane、
  `readWorkspacePanelContext` 报告可见面板集（后续刀）。

## 数据模型

`PanelTabsStoredState` 加一个可选字段（`panel-tabs-storage.ts`）：

```ts
type PanelSplitState = {
  /** 分到下 pane 的页签 id（顺序即下条页签栏顺序）。上 pane = tabs − bottomIds。 */
  bottomIds: string[];
  /** 各 pane 当前可见的页签。全局 activeId 语义不变 = 最后交互的那个。 */
  topVisibleId: string;
  bottomVisibleId: string;
  /** 上 pane 占内容区高度的比例，clamp [0.15, 0.85]。 */
  ratio: number;
};
```

选平铺 `tabs` + 覆盖式 split 描述而不是 `panes: [...]` 重构，是因为一切现有
读方（storage 归一化、`listOpenWebTabs`、`readWorkspacePanelContext`、
singleton 去重）都按 `state.tabs` 平铺读——覆盖式让它们零改动。

不变式（由纯函数模块 `panel-split.ts` 维护，storage `normalizeState` 兜底）：
- `bottomIds` 非空且 ⊆ tabs；上 pane 也非空——任一 pane 空 ⇒ split 解除。
- `topVisibleId` ∈ 上 pane，`bottomVisibleId` ∈ bottomIds。
- `activeId` 必是它所在 pane 的 visibleId（激活 = 该 pane 换可见页 + 全局 active）。

## 纯函数模块 `apps/web/src/lib/panel-split.ts`（TDD）

- `normalizePanelSplit(tabs, activeId, raw)` → 合法 split 或 undefined
- `splitLayout(tabs, split)` → `{ top: PanelTab[], bottom: PanelTab[] }`
- `activateTab(state, id)` / `closeTab(state, id)` / `moveTabToPane(state, id, pane)`
  → 整个 `PanelTabsStoredState` 进出，close 的回退页签在**同 pane 内**找邻居。
- `clampSplitRatio(r)`；`visibleTabIds(state)` → 1~2 个 id（webview 隐藏判定用）。

## 接线

- `use-panel-tabs.ts`：`activate`/`close` 改走纯函数；所有 commit 站点改
  `{...current, ...}` 展开——**否则任何一次 `{tabs, activeId}` 字面量都会静默
  解除分屏**。新增 API：`split`、`moveTabToPane(id, pane)`、`setSplitRatio(r)`。
  `open()` 新页签天然落上 pane（bottomIds 不含它）。
- `right-panel.tsx`：容器变 [Pane 上][分隔线][Pane 下]；每个 Pane =
  简化页签栏 + 内容 host。**keep-alive（表格）用 `createPortal` 挂进所在 pane
  的 host**——换 pane 是 DOM 移动不是 React 重挂，3 万行不重灌。临态面板直接
  作为 Pane children 渲染（换 pane 重挂，甘特本来就重挂便宜）。
  `data-panel-kind` 放在每个 pane 的内容容器上（e2e 依赖它）。
- `panel-tab-bar.tsx`：加 `variant: 'primary' | 'secondary'`。secondary 不带
  标题栏 padding、window-drag、`RightSidebarTrigger` 和「+」（新建只发生在上
  pane，避免「新页签去哪」的歧义）。每个页签 hover 出 PanelBottom/PanelTop
  图标按钮 = 移 pane 手势。
- webview 隐藏判定（`right-panel.tsx` 的 effect）：从「activeTab 不是 web 就
  藏」改为「**可见页签集里没有 web** 才藏」——分屏后 web 可以在非 active 的
  pane 里可见。webview 矩形无需改：web 面板自己 ResizeObserver 量自己容器。
- 分隔线拖动：拖动中用组件本地 ratio（不 commit），pointerup 才
  `setSplitRatio` 落盘——避免拖一次写几十次 localStorage。

## 联动收益（零改动自动成立）

`schedule-locate.ts` 的意图接口不动。表格和甘特分上下 pane 后：点 `job_id`
→ `focusGanttJob` → singleton activate 只是让甘特在自己 pane 里可见（本来就
可见），表格所在 pane 不受影响——「跳转」自动退化为「呼应」。

## 测试

- `panel-split.test.ts`：不变式、移 pane 建立/解除、同 pane 回退、归一化容错
  （坏 id、空 pane、ratio 越界、非对象）。
- `panel-tabs-storage.test.ts`：split 持久化往返、singleton 去重后 split 仍合法、
  旧数据（无 split 字段）加载不变。
- 现有 631 个 web 测试保持绿；`npm run typecheck`；真跑 dev 界面点到底
  （移 pane、拖比例、表格↔甘特联动、web 页签在下 pane、刷新恢复）。
