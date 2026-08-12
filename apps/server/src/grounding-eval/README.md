# 接地评测（grounding-eval）

打真网关、有成本、结果带随机性 —— 所以**不进 `npm test`**（glob 只收 `*.test.ts`）。
判据本身是纯函数，`checks.test.ts` 在常规套件里。

## 前置条件

1. 本地 compass 在跑：`docker ps | grep compass-v2-app`（`compass-v2` 仓库根目录
   `docker compose up -d db app`）。健康检查没有 `/healthz`，404 不代表挂了。
2. Veylin server 在跑：`cd apps/server && npm run dev`（:8787）
3. compass MCP 已注册且 **OBO token 未过期** —— 过期是静默的，工具会返回 0 行而不报错。
   本地 `VEYLIN_COMPASS_IDENTITY` 的 token 要指向**真正在跑的** compass 后端：
   - 连本机 `compass-v2`：`{"url":"http://127.0.0.1:8000", "token": "<account token>"}`
   - 账户身份 token（`role=account`）不是 `issue_token(...,tenant=...,role='central')`
     那种租户 token —— 是靠 `compass_admin identity` 这个 CLI 管：
     ```bash
     docker exec compass-v2-app-1 python -m compass_admin identity list          # 看现有身份
     docker exec compass-v2-app-1 python -m compass_admin identity mint <user> \
       --scene-role central --ttl-days 3                                        # 重铸同一身份的新 token
     ```
     `--scene-role central` 很关键：G5 走 `propose/preview/commit/discard` 这条治理草稿
     通道，需要 central 角色的 scene 绑定，否则会被拒绝。
4. 本地库里有 guolu / shangzhong 数据与至少一次 run（探针时实测：guolu 7219 单 / 14 次
   run，shangzhong 4601 单 / 12 次 run，demo 100 单 / 1 次 run —— 与计划文档描述一致）。
5. Brook VPN 已停（它会杀掉 0.0.0.0 监听，容器端口连不上）。colima 本身会通过 SSH 回环
   把容器的 8000/5432 转发到 mac 主机上；如果 `nc -z 127.0.0.1 8000` 不通，先检查 colima
   状态而不是怀疑代码。
6. **模型端点要能连通**——这个反而是探针里踩到的最意外的坑，见下方「模型端点」一节。

### 模型端点（探针踩到的坑，不是代码问题）

`.env` 里原本两处指向了当次会话摸不到的地址：

- `VEYLIN_BASE_URL=http://127.0.0.1:8088/v1` —— 这是一个私人 SSH 隧道别名，本次会话
  隧道没起来，端口拒连。`compass-v2/.env` 自己的 `COMPASS_LLM_BASE_URL` 用的是同一把
  key/同一个模型的公网网关 `https://llm.youdamaster.cc/v1`（`curl .../v1/models` 200），
  所以把 `VEYLIN_BASE_URL` 改指到这个地址是修网络路径，不是换模型——同一个
  `VEYLIN_MODEL=kimi-k2.7-code`、同一把 `VEYLIN_API_KEY`。隧道恢复后应该改回
  `127.0.0.1:8088`。
- **更隐蔽的一个**：即使 `.env` 配对了，`/api/chat` 仍然报 404（`http://127.0.0.1:8080/v1/chat/completions`）—
  因为 Settings → Models 在 SurrealDB 的 `tenant_settings` 表里存了一条**租户级覆盖**
  （`modelName: "qwen3.6"`, `requestUrl: "http://127.0.0.1:8080/v1"`，来自某次更早的本地
  实验），`getModelConfig` 里 `runtimeOverrides` 的优先级高于 env 默认值。查看：
  `curl :8787/api/model-settings`；清掉：`curl -X DELETE :8787/api/model-settings`（清空后
  `configured:false`，`getModelConfig` 回落到 env 里的 kimi 配置）。**这是数据库里的一条
  设置行，不是代码路径**，换机器 / 换人跑之前应该先 `curl :8787/api/model-settings` 确认
  没有历史遗留覆盖。

## SSE 事件结构（2026-08-11 实测，AI SDK v6 UI message stream）

`POST /api/chat` 返回 **SSE**（`text/event-stream`，`data: {...}\n\n` 逐条，
`data: [DONE]\n\n` 收尾）。真实事件类型清单（一次 G1/shangzhong 探针，
`grep -o '"type":"[a-zA-Z_-]*"' | sort | uniq -c`，按顶层 JSON 的 `type` 精确统计，
不是裸 grep —— 裸 grep 会把 `table_get` 返回里表格 schema 的
`{"type":"text"}` 列类型也算进去，产生假阳性）：

```
1268 text-delta
 264 tool-input-delta
   9 tool-input-start
   8 start-step
   8 tool-input-available
   7 finish-step
   7 data-keepalive
   6 tool-output-available
   5 text-start
   4 text-end
   1 start
   1 tool-output-error
```

计划骨架猜的事件名（`text-delta`/`delta`、`tool-output-available`/`output`）**大部分猜对
了**，但有一处关键出入：

- 最终文本来自：`text-delta` 的 `delta`（string）。**按流出现顺序原样拼接**——`id` 字段
  （如 `"txt-0"`）在每个 step 里都会复位，不能按 id 分桶，只能按到达顺序 append（本采集器
  就是这么做的，和骨架一致）。
- 工具名来自：`tool-input-start` / `tool-input-available` 的 `toolName` 字段，配合
  `toolCallId` 建立映射表。
- **工具返回来自：`tool-output-available` 的 `output` 字段，但这条事件本身不带
  `toolName`！**（`{"type":"tool-output-available","toolCallId":"...","output":{...}}`，
  没有第三个字段。）计划骨架猜的 `evt['toolName']` 在这个事件上永远是 `undefined`——
  必须用同一条 `toolCallId` 回查 `tool-input-start`/`tool-input-available` 建的表。
- 还有一个骨架没提到的事件：`tool-output-error`（`{"type":"tool-output-error",
  "toolCallId":"...","errorText":"..."}`，没有 `output`）—— 工具调用失败时用这个，不是
  `tool-output-available` 里塞个 error 字段。采集器把它也计入 `toolCalls`（`result:
  {error: errorText}`），不静默丢弃，否则一次失败调用在结果里完全消失，看起来像没调过。
- 流级错误（比如模型端点整个连不上）：顶层 `{"type":"error","errorText":"..."}`，
  `text`/`toolCalls` 都会是空的。采集器把这段错误文本前置进 `text` 里，方便事后 diff 出
  “这次是模型端点挂了” vs “这次是模型真的没提到关键信息”。

代表性样本（一次 `table_get` 调用的完整三段）：

```
data: {"type":"tool-input-start","toolCallId":"functions.table_get:0","toolName":"table_get","dynamic":false}

data: {"type":"tool-input-available","toolCallId":"functions.table_get:0","toolName":"table_get","input":{"sheet":"schedule","offset":0,"limit":50}}

data: {"type":"tool-output-available","toolCallId":"functions.table_get:0","output":{"sheet":"schedule","totalRows":30923,"offset":0,"limit":50, ... ,"source":{"server":"compass","project":"8657aa7d-...","tenant":"shangzhong","loadedAt":"..."}}}
```

### 顺带发现，不是这一刀要修的，但下一个人应该知道

- 探针那一轮里，模型（kimi-k2.7-code）面对“现在能不能按期交？”**没有调用任何 compass
  接地工具**（`get_cockpit`/`run_report` 之类），而是直接 `table_get` 拉 `schedule` 表原始
  行，然后打算自己分页扫完 30,923 行去算平均，还派发了两个子 agent（`task`）去帮忙统计——
  子 agent 汇报说“看不到 table 工具”，等于白跑。这条 case 一轮真实跑了 2 分钟以上都没跑
  完（被 curl 的 `-m 120` 掐断，服务端那边应该还在继续，`maxSteps=25` 会兜底但不保证快）。
  这不是本刀（采集器）的问题——只是提醒下一个看接地判据结果的人：如果发现
  `toolCalls` 里全是 `table_get` 而不是诊断类工具，那可能是接地提示词没把模型引导到位，
  是一个真实的产品信号，不是采集器的 bug。
- `sendReasoning: true` 在 chat.ts 里开着，但这个模型/网关组合**没有产出独立的
  `reasoning-*` 事件**——它的 `<think>...</think>` 内容直接混在 `text-delta` 里（探针里能
  看到裸的 `"</think>"` 字面量出现在文本流中）。也就是说 `Sample.text` 里可能包含模型的
  思维链原文，判据（`checks.ts`）如果扫描裸文本找“可信度 0.xx”这类模式，思维链里的自言
  自语也会被扫到——目前判据设计本来就是"哪里出现都算"，这里只是提醒：别把 `text` 当成
  "干净的最终回答"来读，人工复核 `numbersToReview`/`violations` 时最好带着这个心理预期。

## 租户怎么选

**不是**给整个采集器进程一个租户参数，也不是分开的 MCP 条目——是**每个会话（threadId）
钉一个项目**：

```
POST /api/project  { threadId, project: <projectId> }
```

之后这个 `threadId` 打 `/api/chat` 时，服务端把这个 pin 解析成一个**场景集**
（`resolvePinnedProjectScope`），Compass 连接池按这个场景集组出
`x-compass-source` 头，agent 这一轮能看到的工厂数据就被这个头锁死。

- Veylin 有一个统一账户身份（`VEYLIN_COMPASS_IDENTITY`），reconciler 每 10 分钟对账
  `GET {url}/my/sources`，为每个被授权的场景自动建一个**单场景托管默认项目**（名字是场景
  的中文标签，比如“上重”“锅炉厂”），`managed: true`，`sources: ["shangzhong"]` 这种。
- 本地探针实测：`GET /api/projects` 会看到三条——两个单场景托管项目
  （`sources:["guolu"]` / `["shangzhong"]`）加一个人工建的多场景“对比分析”项目
  （`sources:["guolu","shangzhong"]`）。
- **一次会话能不能打多个租户**：能，但只有钉在多场景项目上、且每次工具调用显式带
  `scene` 参数时才行（`docs/compass-integration.md`：“多场景项目里，agent 每次调工具都
  必须指明 scene”）。采集器不控制模型怎么调工具，没法保证它会记得带 `scene`——所以
  **采集器从不使用多场景项目**，只用单场景托管默认项目，保证每个样本的 `tenant` 字段
  就是这个线程唯一可能打到的厂，不会出现"钉的是对比项目、但模型忘记传 scene、实际上
  在个人区/别的厂"这种说不清的情况。
- 因此计划里设想的退路（`VEYLIN_EVAL_TENANT` 限定单租户、分两次跑再合并）**不是必需
  的**：既然租户是按 threadId 钉的，采集器本来就已经在给每个 `(case, tenant, attempt)`
  开一个全新的 threadId（`eval-${label}-${c.id}-${tenant}-${attempt}-${Date.now()}`），
  跑之前先把这个 threadId 钉到该租户对应的单场景项目上即可，一次进程内就能覆盖
  `GROUNDING_CASES` 里声明的所有 `tenants`。`VEYLIN_EVAL_TENANT` 仍然保留在采集器里，
  但只是一个**可选的窄化**（比如只想单独重跑 shangzhong 的 case 时用），不是绕过限制
  的退路。
- 找不到某个租户对应的托管项目（比如这个环境没被授权那个场景）时，采集器**跳过并打
  警告**，不会在结果文件里编一个从没打到过的 `tenant` 字段——这是计划原文明确要求的
  底线（“不要伪造一个跑不到的租户维度”）。

## 失败怎么记（第一轮审查修的两个 Important）

结果文件里每个样本现在多一个字段：

```ts
error: string | null;   // null = 真的跑完一轮对话并被判据评过;非 null = 采集本身出了问题
```

`error` 非 null 的两种来源：

1. `pinThreadToProject`/`askOnce` 失败(pin 打不到项目、chat 超时、网络错误)——这种情况下
   `askOnce` 根本没跑起来，`text`/`toolCalls`/`violations` 都是空的占位,`text` 会带一个
   `[collector error] ...` 前缀方便人眼扫,但**不要**依赖这个自由文本前缀做判断——机器判断
   一律看 `error` 字段。
2. G5 攒好的答案是真的,但事后 `discardDraft`(`POST /api/schedule-edit/discard`)失败——
   这种情况下 `text`/`toolCalls`/`violations` 仍然是这轮真实收集到的数据,只是清理草稿
   这一步没做成,`error` 里会带 `discard failed: ...`,和上面第一种失败共用同一个字段/同一套
   下游处理,不单独开一条通道。

**每个消费者都必须认这个字段**,而不是只看 `violations`:

- `main()` 结尾的汇总行把 `error !== null` 的样本单独算成"采集失败",不计入"成功"和"有硬
  违规"的分母——一次 pin 失败(`violations: []`)不会被算成"零违规的干净通过"。
- `--compare` 里,只要两侧任意一侧 `error !== null`,这条 sampleId 直接打印成"采集失败,
  不比较",不会走到 violations 的 diff 逻辑——两个都是空 `violations` 数组时,老代码会把
  "一个真的跑完零违规"和"一个压根没跑起来"都判成"没变化",这正是审查抓到的坏味道。

`--compare` 还有一个**已知的范围限制,不是遗漏**:它只对比 `violations`(硬判据),完全不看
`numbersToReview`(半自动、不判红的数字线索——理由见 `checks.ts` 顶部注释)。一次干净的
`--compare`(没有任何行打印出来)只保证"硬判据没变化",**不保证"数字线索也没变化"**——如果
要确认改动前后模型给的数字有没有漂移,仍然要人工翻两份结果文件里的 `numbersToReview`。

## 中断怎么办

- **增量落盘**:`main()` 每跑完一个 case×tenant 就把当前已收集到的全部样本重写一次到
  `grounding-<label>.json`,并把顶层 `partial` 标成 `true`;整个 sweep 跑完后再重写一次,
  `partial: false`。也就是说进程随时被杀掉,磁盘上那份文件永远是**合法 JSON**,`partial`
  字段诚实地说明它是不是跑完了——不会出现"写了一半的 JSON 打不开"或者"看起来跑完了其实
  半途而废"这两种情况。
- **SIGINT/SIGTERM**:采集器装了信号处理器。如果收到信号时正好卡在一个 `needsCentralRole`
  (目前只有 G5)的 attempt 中途——已经 pin 了线程、可能已经开出草稿、但还没来得及跑到
  `discardDraft` 那一步——处理器会先补打一次 discard 再退出,把这次中断可能留下的草稿清掉。
  这不是万能的:如果信号来的时候连 pin 都还没打(草稿肯定还没开),或者已经过了 discard 那一
  步(已经清过了),这次补discard只是个空操作,无害。**手动清理仍然是最终兜底**——如果采集器
  进程被 `kill -9`(SIGKILL,信号处理器拦不住)或者机器直接断电,唯一的办法还是人工对着残留
  的 threadId 打一次 `POST /api/schedule-edit/discard`。

## 跑法

    VEYLIN_COMPASS_GROUNDING=0 node --import tsx src/grounding-eval/run.ts --label before
    node --import tsx src/grounding-eval/run.ts --label after      # 改 env 后需重启 server
    node --import tsx src/grounding-eval/run.ts --compare before after

单独重跑一个厂：`VEYLIN_EVAL_TENANT=shangzhong node --import tsx src/grounding-eval/run.ts --label smoke`

结果落 `apps/server/eval-runs/grounding-<label>.json`（已 gitignore）。

采集器会自动加载仓库根目录的 `.env`（复用 `server.ts` 同一条 `env.ts` 加载路径），
所以结果文件里的 `model` 字段就是 `.env` 里的 `VEYLIN_MODEL`，不需要手动 `source`。
冒烟阶段踩过一次反例：第一次跑忘了这条，`model` 落成了 `null`——采集器进程自己的
shell 没有继承 server 那份 `.env`，补上 `import '../env.js'` 之后才对上。

其他可调环境变量：

- `VEYLIN_EVAL_BASE`（默认 `http://127.0.0.1:8787`）
- `VEYLIN_EVAL_ATTEMPTS`（默认 `3`）
- `VEYLIN_EVAL_TIMEOUT_MS`（默认 `480000` = 8 分钟）——探针实测到模型可能在没有接地
  工具引导时自己分页扫全表，单轮可能拖很久；裸 `fetch` 不设超时会让一次跑坏的 case
  卡住整个采集器。
- `VEYLIN_EVAL_TENANT`（可选）——只跑这一个租户，见上「租户怎么选」。
- `VEYLIN_EVAL_CASES`（可选，逗号分隔的 case id，如 `G3,G5`）——只跑这几条 case，给便宜的
  手动验证/调试用（比如只想单独确认某条 case 的行为，不用把 8 条全跑一遍）。不影响正式
  基线跑法，正式跑不传这个变量即可覆盖 `GROUNDING_CASES` 全集。

## 硬性要求

- **G5 会产生编辑草稿**，每次采样后必须 `discard`。采集器已自动做（`POST
  /api/schedule-edit/discard` 带上这次的 `threadId`，因为 discard 也是按线程钉定的项目
  解析范围）；若中途中断，手动对残留的 threadId 打一次 discard 清掉，否则污染下一次跑
  和真人的工作区。
- 结果只在**当次的模型**下成立，换模型必须重跑基线。
