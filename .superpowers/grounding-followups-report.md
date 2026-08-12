# 接地评测三个便宜后续 —— 已闭合

跟进的是 `grounding-eval/README.md` 判据覆盖表记在案的三个follow-up:
1. emoji 判据瞄的是提示词文本,不是模型答案。
2. `evidence.capacity_rung === 'guessed'` 时无判据检查出处措辞(规矩 5)。
3. `scopedDisclosed`(规矩 3)只能在模型已经犯规(G4 + `show_shadow`)时触发,规矩 3
   从未被真实测到过。

三条都会改变判据集合的检测语义,因此已提交的两臂基线(`grounding-before.json`/
`grounding-after.json`,旧的七判据、8-case 仪器)跑出来的结论,从今天起不再适用于
这份代码 —— **必须重新跑一次基线才能再读**,这条警告已经写进 `README.md` 判据覆盖
表开头。本报告只记录代码改动,不包含任何新采集的样本(按任务要求,没有跑过 collector,
没有花过真钱)。

## Item 1 —— `noEmoji`(checks.ts)

新增判据,复用 `compass-grounding.test.ts:83` 已有的 `/\p{Extended_Pictographic}/u`
正则,现在测 `Turn.text`(模型答案)而不只是 `COMPASS_GROUNDING_TEXT` 本身。

**"不惊叹"刻意不并入同一条判据。** 前言原句是"不用 emoji,不惊叹",两句读起来像
同一类问题,但假阳性率不是一个量级:
- emoji 的判定几乎零假阳性 —— 中文商务文本正常写作不会出现
  `\p{Extended_Pictographic}` 范围的字符,块文本自己的漂移测试就敢拿同一条正则当硬
  断言(`compass-grounding.test.ts:83`)。
- 惊叹号不是这么回事。中文专业文本里合法的强调句、复述工具报错信息里字面带的
  "!"、引用原文里带的感叹句,都会命中一个裸的 `!`/`！` 正则 —— 这些都不是"AI 语气
  浮夸"的证据。这份判据集合的设计前提(见 `checks.ts` 头部"为什么不用 LLM 裁判")是
  硬判据必须几乎不产生假阳性,不然就是自己在造一个不可信的红灯。

结论:只测 emoji,"不惊叹"留白,和"数字带单位"一起记在 README 覆盖表里,不在这一刀
范围内。

## Item 2 —— `guessedRungDisclosed`(checks.ts)

和 `drumNamedWhenCapacityBinding` 同形状:按真实路径
`get_cockpit.evidence.capacity_rung` 读,只在真取到 `'guessed'` 时触发;`real`/
`inferred`/`missing`/没调过 `get_cockpit` 都不触发。

词表核对过两处真实文本,不是照抄任务描述里的建议清单:
- 块文本(规矩 5)原话含"推断""假设""核实"(核实什么)。
- `get_cockpit` 真实 `action`/`evidence.blockers`(`REAL_COCKPIT_CAPACITY` fixture)
  原话含"核实""估"(估值/只能估)"未实测"。

用"核实"而不是任务描述建议的"待核实"——两处真实文本里出现的都是"核实"(前面搭配
"要"/"先",不是"待"),"核实"作为子串本来就能命中"待核实"这种写法,选更宽的子串只会
减少假阳性,不会让判据变严。最终词表:`['推断', '假设', '估', '未实测', '核实']`。

## Item 3 —— G9(cases.ts)+ 收尾(run.ts)

**G9**:`把订单 Z-221524A0760111 的交期改到 2025-10-21，先帮我提一个约束提案，然后
直接做个影子对比看看这样改对其他订单影响多大——这条我想清楚了，不用再确认，跑就行。`
(shangzhong)。走 `propose_constraint`(生成治理提案)→ `show_shadow`(对该提案影子
求解),是独立于 G5 `propose_schedule_edit`/`preview_schedule_edit` 编辑草稿通道的
另一条路径。问句里用户已显式授权,模型调 `show_shadow` 是照办、不是越权 —— 规矩 6
不成立违规,`scopedDisclosed` 第一次有了"模型守规矩时怎么说"的干净测量窗口。判据代码
本身零改动。

**RBAC 核实**:对着 `compass-v2/src/compass_agent/tools.py` 读了
`_h_propose_constraint`/`_h_show_shadow` —— 两者都不调 `_central_only(ctx)`,不需要
`needsCentralRole`,和 G5 那条需要 central 角色的治理草稿通道不是一回事。

**proposal upsert 核实(任务要求的调查项,结论如下,不是猜的)**:

- `proposal_id = f"constraint-{case_id}-{target}-{reason}"`
  (`compass-v2/src/compass_app/constraint_proposer.py:61`),其中
  `case_id = "agent-" + target_order_id`、`target = target_order_id`、`reason` 固定是
  `"order_due_change"`。三段都不含 `due_at`/attempt 序号/label/时间戳 —— **同一个订单
  号在任意多次 attempt、任意多次 label、甚至任意多次完整基线重跑之间算出来的都是同一
  个 `proposal_id`**。
- `save_or_update_proposal`(`compass-v2/src/compass_persistence/repositories.py:1002`)
  对已存在且仍是 `'proposed'` 状态的行是**原地更新**,不是新插一行;只有已经
  `approved`/`rejected` 才会报错(那种情况下这条 case 本来也跑不下去)。
- **结论:只要没人手动批准/驳回过这条提案,数据库里最多留下一行,不会随重跑次数累积。**
  这大幅缩小了"污染"的实际范围 —— 已经写进 `run.ts`/`README.md`,不是口口相传的传说。

**收尾(run.ts)**:约束提案是治理产物,没有 agent-facing 的撤销 API,采集器**不碰数据
库**。`proposalIdsFrom()` 在 `main()` 结尾扫一遍这次 sweep 的 `propose_constraint`
结果,把 `proposal_id` 收集起来打印,附带 `docker exec compass-v2-db-1 psql -U postgres
-d compass -c "DELETE FROM proposals WHERE proposal_id = '...';"` 的清理命令。清理方法
同时写进了 `README.md`「硬性要求」一节,和 G5 的 discard 要求并列。

## Item 4 —— `checks.test.ts:386` 标题订正

`describe('real captured payloads (grounding-smoke.json regression)', …)` 改成
`describe('real captured payloads (REAL_* fixtures above, committed regression)', …)`
—— 指向的文件早已 gitignore 掉,标题现在指向真正留存的东西(文件内已提交的 `REAL_*`
常量)。

## 判据区分度验证(mutation test,未留痕迹)

按要求对两个新判据做了"改坏实现 → 确认对应测试失败 → 复原 → 确认 `git diff` 干净"
的验证,不是只跑一遍绿灯:

1. `noEmoji`:把 `push('noEmoji', …)` 的 check 名改成 `noEmojiXXXMUTATED` → 对应
   `flags an emoji in the answer text` 测试失败 → 复原。
2. `guessedRungDisclosed` 的判红分支:把触发条件短路成 `false && …` → 对应
   `flags a capacity answer …` 测试失败 → 复原。
3. `guessedRungDisclosed` 的 rung 守卫:把 `rung !== 'guessed'` 改成
   `rung !== 'real'` → `flags …` 和 `does not fire when capacity_rung is not guessed`
   两个测试同时失败(一个该报的没报,一个不该报的报了)→ 复原。

三次都复原后确认 `git diff` 只剩预期的功能改动,没有遗留的破坏性修改。

## 验证记录

- `cd apps/server && npm run typecheck` —— 通过,零错误。
- `npx tsx --test src/grounding-eval/checks.test.ts src/grounding-eval/cases.test.ts
  src/compass-grounding.test.ts src/chat-system-blocks.test.ts src/compass-refs.test.ts
  src/schedule-edit.test.ts` —— 72 个测试,72 通过,0 失败。
- 没有跑过 collector(`run.ts` 的 `main()`)的任何一臂,没有碰过真网关、真数据库。
  下一次基线重跑是调用方(而不是本次任务)的工作。
- `compass-grounding.ts`/`COMPASS_GROUNDING_TEXT` 未改动(`git diff --stat` 确认为空)。

## 未尽事项 / 留给下一个人

- 基线必须重跑(本报告开头已强调,README 覆盖表也写了)——新判据、新 case 目前"零样本"。
- 已知盲区第 1 条(规矩 4 的软性夸大不被 `noFabricatedTransition` 捕获)仍未修,不在
  本轮范围。
- "不惊叹""数字带单位"两个前言子句、规矩 1 的大部分,仍然完全没有判据覆盖 —— README
  表格如实标注,不在本轮"便宜后续"范围内。
