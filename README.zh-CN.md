# Veylin

[English](./README.md) · 简体中文

从头重设计的通用 Agent 平台。**嵌入式 SurrealDB 单引擎**（文档+图+向量+全文），运行时内核，Fastify 薄 BFF，Tauri + React 客户端。打包为桌面应用后**双击即用**：服务端以内嵌 Node 的 sidecar 二进制随安装包分发，无需用户单独安装 Node / Docker / Postgres / Redis。

## 特点

- **完整的 Agent**：自带工具调用、计划模式、子智能体、技能与记忆，端到端完成任务。
- **无需写代码**：可视化工作流编排、定时与事件自动化、技能/规则/MCP 配置全部在 UI 完成。
- **权限与隐私优先**：本地优先、单机自托管；危险操作走审批门；数据默认留在本机。
- **领域无关**：不绑定单一行业，角色与指令通过 agent.yaml 与技能注入。
- **介于「手搓」与「全包」之间**：易于 DIY，又开箱即用。
- **企业自托管**：零外部依赖，可离线运行。
- **右侧统一可 DIY 面板**：表格 / 网页 / 知识库(RAG) / 知识图谱 / 工作流。
- **完整国际化**：默认英文，可切换简体中文；Agent 回复语言跟随界面语言。

## 架构

```
Tauri 壳 (apps/desktop)
  └─ React + assistant-ui (apps/web) ── AI SDK useChat 流式
        └─ veylin-server sidecar (apps/server) ── 单租户/免登录 + SSE + 策略前置 + 进程内队列
              └─ Runtime (packages/runtime) ── Agent / Network / Processors / Memory
                    ├─ 工具层 (packages/tools, packages/mcp-servers)
                    ├─ 策略层 (packages/policy)
                    ├─ 嵌入式 SurrealDB (packages/db) ── 业务表 + 知识库图谱/向量/全文
                    └─ 本地 LibSQL ── 线程记忆 + 语义召回向量
```

## 本地启动（开发）

```bash
cp .env.example .env          # 填模型 key；数据默认落 ./data
npm install
npm run dev                   # server :8787 + web :5174（数据自动初始化，无需 Docker）
```

数据目录由 `VEYLIN_DATA_DIR` 指定（默认 `~/.veylin`），首启自动建 SurrealDB schema 与种子数据。桌面模式 `VEYLIN_DESKTOP_AUTH=1` 单租户免登录。

## 打包桌面应用（双击即用）

```bash
npm run -w @veylin/desktop build  # 自动：构建前端 → 打包 sidecar(含内嵌 Node + SurrealDB 原生模块) → tauri build
```

产物：

- macOS：`apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg`（+ `.app`）
- Windows：`*.msi/.exe`；Linux：AppImage/deb

安装后双击：Tauri 启动 sidecar → 内嵌 Node 跑 `server.mjs` → SurrealDB(surrealkv) 自动初始化 → 前端 `/api` 直连本地 sidecar。

桌面安装包**不内置模型凭据**。首次聊天前，请从左下角用户菜单进入 **Settings** → **Models**，配置你自己的 OpenAI-compatible API Key。

## 上下文工程

长对话时 Veylin 会分层管理上下文，避免超出模型窗口：

- **System prompt 分层**：静态 instructions（角色、沟通规范）与每轮动态块（技能、规则、RAG、提醒）分开组装；稳定段落进程内缓存，`/api/compact` 后清空重拼。
- **微压缩（microcompact）**：只读大结果工具（如 `knowledge_search`、`web_fetch`）的旧输出替换为占位符，保留最近几轮完整结果；关键事实应在助手回复中记下。
- **Compaction**：历史超阈值时摘要较早消息（支持 LLM 九段式摘要）；阈值可按 context window 比例自动触发（`VEYLIN_AUTOCOMPACT_PCT`）。
- **沟通规范**：首次调工具前一句话说明、关键节点短更新、回合末 1–2 句总结（改了什么 + 下一步）。

相关环境变量见 `.env.example` 中 Context engineering 一节。

## 会话持久化边界

刷新或切换线程时，以下状态会恢复：

| 恢复 | 来源 |
|------|------|
| 聊天消息 transcript | LibSQL（Mastra Memory） |
| Todos | SurrealDB `thread_state`；空库时从 transcript 最后一次 `todo_write` 回填 |
| Plan mode | SurrealDB + `GET /api/plan-mode` |
| 子 agent 任务行（状态/结果） | SurrealDB `task` + SSE `/api/tasks` |
| 已激活 skills（只读 chip） | `GET /api/threads/:id/state` |
| 挂起的 `ask_user_question` | 从 transcript 重建 |

以下**不**跨刷新恢复（设计如此或本轮未做）：

- 进行中的主流式响应（进程内 resumable stream，重启即失效）
- Composer 消息队列、未发送的附件/浏览器引用
- Worker 子线程完整 transcript UI
- Working memory 文档的可视化编辑
- `read_open_page` 客户端挂起态

## 关键决策

- 存储：**嵌入式 SurrealDB 单引擎**（业务表 + 知识库 图+向量+全文），线程记忆旁挂本地 LibSQL；不依赖外部 Postgres / Redis / Docker。
- 队列：进程内 `p-queue` + `node-cron`，无外部依赖。
- Embedding：本地 fastembed（离线），可切 API。
- 分发：server 编译为单文件 bundle + 内嵌官方 Node 运行时，作为 Tauri sidecar 打包，目标机零运行时依赖。

## Customize & Automate

veylin 提供全屏 Settings 面板（左侧导航 + 右侧内容）：

### Customize

- **Skills**：内置技能可禁用；自定义技能 CRUD。Composer 选择 skill 后通过 `pendingSkill` 自动激活。
- **Rules**：always / keyword 规则注入 system prompt。
- **MCP**：bundled stdio 只读；远程 SSE/HTTP 可增删改，写后刷新工具集。

API：`GET/POST/PUT/DELETE /api/skills`、`/api/rules`、`/api/mcp-servers`

### Automate

- **定时**：`automations` 表 + 进程内队列（node-cron）；每次运行新建 thread，写入 `automation_runs`，出现在会话列表。
- **事件**：`POST /api/events/{tenantId}/{source}`（HMAC 验签）；按 OpenHands 风格 `on` + JMESPath `filter` 匹配 `kind=event` 的 automation 后投递队列。

API：`GET/POST/PUT/DELETE /api/automations`、`POST /api/automations/:id/trigger`、`GET /api/automations/:id/runs`、`GET/POST/DELETE /api/webhooks`

## 安全

请阅读 [SECURITY.md](./SECURITY.md)。生产/共享部署务必设置 `AUTH_SECRET` 并关闭桌面免登录。

## 许可证

[MIT](./LICENSE)
