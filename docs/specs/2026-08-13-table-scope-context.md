# 表 = context,context 有归属

**一句话**:表格不是"工作区里的一块数据",它是**某个作用域的 context**——个人的、项目的、或这一轮对话的。你在哪个作用域,就看到那个作用域的 context。

Status: DRAFT · 2026-08-13 · owner: gushirui

---

## 0. 为什么现在写

三种 context 载体,今天归属三套规则,互相打架:

| 载体 | 今天归谁 | 代码位置 |
|---|---|---|
| 上传文档(知识库/RAG) | **对话**(tenantId + threadId) | `rag-store.ts` |
| 表格 sheet | **工作区全局**(compass 装的 `thread_id = null`) | `table-store.ts` |
| Compass 数据连接 | **项目**(会话钉定) | `mcp-scoping.ts` / `project-store.ts` |

两个已经在真机上发生的后果:

1. **两个项目共用一张表。** 三张 compass 表的 id 是全局常量(`schedule`/`orders`/`workorders`)。在 guolu 项目里装一次,**直接覆盖**上重那一份 —— 不是"看得见别人的",是同一张表被轮流改写。
2. **个人区看得见项目数据。** `GET /api/table` 只查 sheet 的 `thread_id` 归属,不看项目钉定;compass 表 `thread_id = null`,于是任何会话都拿到全部行。而 agent 那侧的 G1 检查(`table_get` 的 `isUnscopedProjectData`)会拒绝 —— **屏幕上摆着三万行,agent 说"我看不到这张表"**。两边说法不一致,比两边都开或都关更糟。

根子不是"面板少了一道过滤",是**表没有归属**。

## 1. 模型

**context 分层,每层都有,载体归载体。**

- **个人** —— 我自己的(个人区上传的 Excel/Word/PPT、我自己建的表)
- **项目** —— 项目的(compass 装进来的排产表、项目里传的文件)
- **对话** —— 就这一轮的(临时表、这次对话的附件)

一条规则:**你在哪个作用域,就看到那个作用域的 context**;加一级继承:

```
项目里的会话  =  项目 context + 本对话 context
个人区的会话  =  个人 context + 本对话 context
```

层与层之间不串:项目的不漏到个人(第 0 节第 2 条),个人的也不自动进项目(对称)。

这条规则一出,两个问题都是它的推论:guolu 和上重各有各的 `schedule`,不再互相覆盖;没选项目 = 个人区,看到的是我自己的表,不是上重的。

**产品参照**:Claude 项目页的 Instructions / Memory / **Context** / Scheduled。Context 那一栏放文件夹和链接;我们的表就该在那个位置。区别只在于我们承认个人区也有 context —— 个人也能有项目,个人对话也会传 Excel。

## 2. 这一刀的范围

**做**:表格获得归属。

**不做**(理由见 §6):文档(RAG)升到同一套归属;项目页的 Context 区;"把个人的表拿进项目";任何跨机/多人共享。

## 3. 设计

### 3.1 归属字段:`scope`,不是 `projectId`

```ts
export type SheetScope =
  | { kind: 'personal' }                  // 个人区
  | { kind: 'project'; id: string }       // 项目 id(Project.id)
  | { kind: 'thread'; id: string };       // 单个对话(现有 thread_id 语义)
```

落库把 `thread_id` 换成 `scope_kind` + `scope_id`。

**为什么不是简单加个 `projectId`**:Veylin 这边今天**没有共享层** —— `table_sheet` 表里连 tenant/user 维度都没有,全在本机嵌入式库;同事各自跑一整套栈。多人是 Compass 那侧的事(同场景、各自身份、RLS + 治理提案)。但将来 Veylin 真有了服务端多人,"归属"就要长出 owner 与可见性。留成结构体,那天是给 scope **加字段**,不是重构。

### 3.2 sheet id:内部带作用域,对外仍叫 `schedule`

- 内部 id:`${scopeKey}~${slug}`,`scopeKey ∈ { me | p_<projectId> | t_<threadId> }`。
  例:`p_proj-guolu~schedule`、`me~main`。
  **分隔符不用冒号**(原稿写的是冒号):SurrealDB 的记录 id 就写作 `table:id`,
  在里面再塞冒号要靠 ⟨⟩ 转义,是自找的麻烦。`~` 在 URL 里是非保留字符。
- 对外(agent 工具的 `sheet` 参数、REST 的 `?sheet=`、选区的 `sheet` 字段)**仍然是短名** `schedule`。
- `resolveTableSheetId(shortName, scope)` 负责短名 → 内部 id。同一句 `table_get(sheet:'schedule')` 在两个项目下解析到两张不同的表,这正是要的效果 —— agent 和人都不用改口。

**例外**:选区(`table-selection.ts`)存**内部 id**,不存短名 —— 选区是"当时圈的那一块",跨作用域不该被重新解释。

### 3.3 作用域从哪来:一处推导

```ts
// 唯一入口,三个调用面都用它
resolveSheetScope(threadId, projectPin): SheetScope
//   有 pin  → { kind: 'project', id: pin }
//   无 pin  → { kind: 'personal' }
// 对话级不从这里来:只有 `table_create_sheet` 显式带 ephemeral 标志时才写
// { kind: 'thread', id: threadId } —— 见 §3.4。
```

三个调用面:

| 面 | 怎么拿到 threadId / pin |
|---|---|
| agent 工具 | `ctx` → `readThreadId` / `readProjectPin`(已有) |
| REST 路由 | 请求里的 `threadId` → `resolveThreadPin`(已有) |
| 面板 | `useAuiState` 的 threadId(已经是响应式的,只是现在没被用来重取) |

### 3.4 写入路径

- **compass 三张表**(`importCompass{Schedule,Order,Workorder}Sheet`):scope = 当前项目钉定。**没有钉定时显式拒绝**并说清原因("当前会话没有选项目,无法装载项目数据")。今天是靠 `resolveCompassServer` 拿不到 entry 间接失败,报的是 "not connected" —— 原因不对。
- **Excel 导入 / 面板新建**:scope = 当前作用域(项目 or 个人)。

  **这是行为变更**:今天面板新建的表走 `requireThreadId`,是**对话级**的,换个对话就不见了。改成跟随当前作用域 —— 在面板上建一张表是工作区行为,不是"这一轮的临时物"。
- **`table_create_sheet`**:默认当前作用域;保留一个可选的对话级(agent 要临时表时用)。

### 3.5 面板跟着钉定走

- `GET /api/table`、`GET /api/table/sheets` 按解析出的 scope 列表与取数(今天完全不看 pin)。
- 面板的加载 effect 依赖加上 `threadId`:切对话 → 重取 sheets 与当前表。
- 切换后若 `activeSheetId` 不在新作用域 → 落到该作用域的默认表;没有表就空态。
- **默认表 `main` 归个人**(`me~main`)。所以**进到一个新项目时是空态**,直到装载或导入 —— 这是对的:项目里不该凭空有一张我个人的空表。相应地,`ensureAtLeastOneSheet`(删掉最后一张表后补一张)的"至少一张"是**按作用域**算,不是全局算。
- **空态文案**(个人区、没有表):说清楚现状和下一步,不解释机制、不说教。
  > 这里还没有表。选一个项目可以装排产数据,或者直接把 Excel 拖进来。

### 3.6 老数据回填

启动时一次性迁移,幂等(已带 scope 前缀的跳过):

| 老状态 | 落到 |
|---|---|
| `source.project` 有值 | `project(source.project)` |
| 其余(含 `thread_id` 有值的、`main`、无戳的导入表) | `personal` |

**老的对话级表也归个人区**(实现时改的:原稿写的是保留 `thread`)。因为作用域只
从项目钉定推(§3.3),没有任何入口会去列"某个对话的表" —— 留成 `thread` 等于谁也
看不见,在用户眼里就是数据丢了。而这些表多半是在面板上点「+」建的,本来就该是
工作区行为(§3.4)。`thread` 这一档留在类型里,等真需要"这一轮的临时表"时再启用。

id 改写要**级联** `table_column.sheet_id` 与 `table_row.sheet_id`。先做 `--dry-run` 打印将要改写的条目,再落。

## 4. 与 G1 那两道拒绝的关系

`table_get` 现有两道拒绝(`isProjectPinMismatch`、`isUnscopedProjectData`)在新模型下**大部分变成结构上不可达** —— 不在作用域里的表既不出现在列表里,也解析不到短名。

**但不删。** 非聊天上下文的调用(没有 ctx、拿着裸内部 id)仍可能绕过解析。它们从"主要机制"降级为"不该发生时的守卫",保留作纵深防御。这与 [[veylin-project-scoping]] 记的教训一致:**结构上拒绝,不靠提示词**。

## 5. 测试计划(先写测试)

不变式,每条一个测试:

1. **同名不互覆盖**:guolu 与上重各装一次 `schedule`,两张表并存,行数与来源戳各自独立。
2. **看不见对方**:个人区列不到项目的表;项目里列不到个人的表;项目 A 列不到项目 B 的。
3. **短名随作用域解析**:同一句 `table_get(sheet:'schedule')`,在两个项目下拿到不同数据。
4. **无钉定装载被拒**,且理由是"没选项目",不是"not connected"。
5. **选区跨作用域不串**:在项目 A 登记的选区,项目 B 的会话取不到(已有会话隔离,补一条作用域维度)。
6. **迁移**:含 `thread_id` 表、含 `source.project` 表、裸表的老库,各自落到正确作用域,columns/rows 跟着走;重复执行结果不变。
7. **面板跟随**:切到另一个作用域的对话 → sheet 列表变化;原来的表不残留在屏幕上。

## 6. 不做什么,以及为什么

- **"把个人的表拿进项目"**(Claude 的 add to project)。今天它只有便利价值(省一次重导),却要在模型里立一个**将来会变语义**的动作:等 Veylin 有了服务端多人,同一个动作从"整理"变成"发布"——一次不可撤回的分享。而且真到共享那天,该共享的东西分得很清楚:**compass 装进来的表不需要共享**(每人自己连一次就有,数据同源,各自带身份与权限),需要共享的是**人自己产生的**(手工传的 Excel、批注、"这批为什么这么排"的记录)。现在做,会把这两类混成一件事。
- **文档(RAG)升到同一套归属**:第二刀。今天它是对话级,不是错的,只是层级更低。
- **项目页的 Context 区**(表/文档/链接一处看):第二刀,等两种载体归属统一之后。
- **多人共享**:需要 Veylin 有服务端多人(表、对话、context 都要 owner 与权限),另一个量级。

## 7. 风险 / 未决

- **id 改写是破坏性迁移**。必须先 dry-run + 可回滚(嵌入式库整目录备份)。这是本刀最大的风险点。
- **面板是工作区级单例**,切对话重取会与 SSE 推送、编辑中的本地状态竞态。现有 `editingUntil` / `lastSerialized` 机制要覆盖到切换路径。
- **内存**:多项目并存时每个项目各留一份(上重 schedule 30k + workorders 23k ≈ 几十 MB)。可接受;真撑不住再按最近使用淘汰 —— 不在这一刀。
- **未决**:对话级(`thread`)这一层要不要长期保留。这一刀实现下来它**一个用例都没有**(见 §3.6):没有入口产生,也没有入口读取。类型里留着是为了"这一轮的临时表"那个尚未出现的需求。如果一年后仍然没有,应当删掉,少一层。
- ~~**未做**:`/api/table/stream`(SSE)不带作用域~~ **已做(2026-08-14)**:stream 带 threadId → 推出作用域 → 只推该作用域的表;`sheetsChange`(不带 sheet)与认不出归属的老 id 照推(不知道就别拦)。见 `table-event-scope.ts`。

---

相关:`docs/specs/2026-07-07-conversation-to-capability.md`(同样是"用户自己的东西该归谁"这条线);
Compass 侧的场景/项目模型见 compass-v2 `docs/superpowers/specs/2026-07-27-unified-compass-identity-design.md`。
