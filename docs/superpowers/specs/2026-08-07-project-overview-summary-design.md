# 项目首页一屏摘要（Veylin 宿主）

日期：2026-08-07  
状态：已落地（宿主摘要 UI）  
范围：`apps/web` 项目首页宿主 UI；不改 Compass 远端 scene-card widget。

## 问题

项目首页默认塞进完整场景认知卡 iframe：AI 长摘要、问题结构、产能等多段同时展开，信息重复、扫读成本高。卡片内容由 Compass MCP App 渲染，本仓库无 widget 源码。

## 目标

单场景项目打开后，**一屏内看懂规模 + 一句结论**；细节与完整场景卡一键展开。多场景保持对比表，叙事默认折叠。

## 非目标

- 不修改 Compass 远端 `scene-card` HTML/生成逻辑  
- 不改项目钉定、MCP 隔离、修正桥语义  
- 不改聊天内联场景卡  
- 不新增领域 key 硬编码表以外的业务规则（关键数字仅用启发式匹配已有 `display` 行）

## 方案

宿主消费已有 `get_scene_card` payload（`narrative` + `display`），默认渲染轻量摘要；完整 `SceneCardCell` iframe 放在折叠区。

### 单场景（默认路径）

1. **页头**：`PageHeader` 仅项目名；`description` 与名称相同时省略（已有逻辑保留）。  
   **布局**：项目首页内容列加宽（`max-w-6xl`，相对设置页的 `max-w-4xl`）；场景卡宿主 `min-h` 约 `min(72vh, 720px)`，`maxHeight` 提到 2400，减少卡内小视口滚动。  
2. **摘要卡**（新组件，如 `SceneCardSummary`）：  
   - **关键数字**：从 `display` 中启发式挑选最多 3 条（优先 key/label 含订单、二级、三级 / orders、op 等；否则取前 3 条带 `num` 的行；再否则取前 3 行）。展示 `label` + `value`，同一事实不重复。  
   - **一句结论**：`narrative.text` 默认截断约 120 字（按字符），旁有「展开/收起」看全文；无 narrative 则跳过该块。  
   - **分组明细**：其余 `display` 按 `section` 分组，`<details>` **默认折叠**。  
3. **不嵌完整场景卡**：有 `display` 时只渲染宿主摘要（避免与 iframe 上下重复）。「这里不对?」挂在指标/分组行上，走同一修正桥。无 `display` 时仍降级为 `SceneCardCell`。  
4. **对话列表**：默认展示最近 3 条；其余经「显示全部」展开。

### 多场景

- `canMergeCards` 为真时仍用 `SceneCardMergeTable`。  
- 每场景 `narrative` 默认折叠为一行摘要（截断 + 展开），不并排嵌多个完整 iframe。

### 降级

| 条件 | 行为 |
|------|------|
| 无 `display` 或提取失败 | 不画摘要卡，直接现有 `SceneCardCell`（与今天一致） |
| 拉取 error | 现有错误行（「无法加载」）；可另加独立 loadingFallback（非本 spec 必做） |
| 有 `display` 无 `narrative` | 只显示关键数字 + 折叠分组，不造假摘要 |

## 文件（预期）

| 路径 | 职责 |
|------|------|
| `scene-card-summary.ts` | 纯函数：关键数字挑选、叙事截断、section 分组 |
| `scene-card-summary.test.ts` | 上述纯函数测试 |
| `scene-card-summary-panel.tsx` | 摘要 UI（大号指标 + 折叠分组 + 修正桥；不嵌完整卡） |
| `project-overview.tsx` | 单场景走摘要+折叠完整卡；线程默认 3 条 |
| `scene-card-merge-table.tsx` | 叙事默认折叠（若当前已展开则改默认） |
| `zh-CN.json` / `en.json` | 文案：展开、查看完整场景卡、显示全部等 |

## 验收

1. 打开单场景项目（如「上重」）：首屏见关键数字 + 短结论；无完整 iframe 滚动条墙。  
2. 摘要行上「这里不对?」可开修正草稿。  
3. 无 `display` 的卡：行为与改前一致（整卡 iframe）。  
4. 多场景对比表仍可用；叙事不占满首屏。  
5. 对话超过 3 条时默认只显示 3 条。

## 风险

- 关键数字启发式可能选错行 → 宁可少显示，不编造；测试覆盖常见 compass key 样例。  
- 摘要与完整卡内容部分重复 → 可接受；完整卡默认折叠。  
- 未展开时 iframe 未挂载 → 展开瞬间有加载态，需保留现有 loader/error。
