# Veylin

[English](./README.md) · 简体中文

从头重设计的工业 Agent 平台。**嵌入式 SurrealDB 单引擎**（文档+图+向量+全文），运行时内核，Fastify 薄 BFF，Tauri + React 客户端。打包为桌面应用后**双击即用**：服务端以内嵌 Node 的 sidecar 二进制随安装包分发，无需用户单独安装 Node / Docker / Postgres / Redis。

## 特点

- **完整的 Agent**：自带工具调用、计划模式、子智能体、技能与记忆，端到端完成任务。
- **无需写代码**：可视化工作流编排、定时与事件自动化、技能/规则/MCP 配置全部在 UI 完成。
- **权限与隐私优先**：本地优先、单机自托管；危险操作走审批门；数据默认留在本机。
- **工业通用**：不绑定单一行业，领域角色通过 agent.yaml 注入。
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
- **事件**：`POST /api/webhooks/:token`（GitHub `X-Hub-Signature-256` 或自定义 HMAC）；匹配 `kind=event` 的 automation 后投递队列。

API：`GET/POST/PUT/DELETE /api/automations`、`POST /api/automations/:id/trigger`、`GET /api/automations/:id/runs`、`GET/POST/DELETE /api/webhooks`

## 安全

请阅读 [SECURITY.md](./SECURITY.md)。生产/共享部署务必设置 `AUTH_SECRET` 并关闭桌面免登录。

## 许可证

[MIT](./LICENSE)
