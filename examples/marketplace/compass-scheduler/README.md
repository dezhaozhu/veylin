# compass-scheduler — Compass 智能排产插件

把 [Compass](https://mcp.compass-work.com) 排产引擎接入 Veylin：真实多厂数据、治理编辑（propose→preview→commit）、增量重排、鼓点/资源负荷分析，共 14 个 MCP 工具。

## 安装（两步）

1. 在 Veylin 设置 → 插件 → Marketplace 安装 **compass-scheduler**。
2. 打开安装目录下的 `.mcp.json`，把 `COMPASS_MCP_TOKEN` 换成你的 **project token**，重启会话即可。

## project token 是什么？从哪来？

一个 project = 你在 Compass 上的一个排产数据集绑定（单厂，或人为配置的多厂只读视图）。token 由 Compass 自助开通接口签发：

```bash
# 用你的 account token（找管理员开通）创建一个 project：
curl -X POST https://mcp.compass-work.com/projects \
  -H "Authorization: Bearer $ACCOUNT_TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "我的排产", "sources": ["guolu"]}'
# 响应里的 mcp_token 就是要填进 .mcp.json 的值
```

要点：

- **token 即边界**。一个 token 只能看/改它绑定的 project，切 project = 换 token（在 Compass 侧完成，agent 无法切换——这是有意的安全设计）。
- token 可随时**轮换/吊销**（`POST /projects/{id}/token` / `DELETE /projects/{id}`），旧 token 立即失效。
- 多厂 project 是只读对比视图；要写入请用单厂 project。

## 结构

```
.mcp.json            MCP 声明（本地 stdio 桥 → 远程 Compass）
mcp/bridge.cjs       stdio↔HTTP 转发桥（零依赖，Node ≥18）
references/          agent 行为手册：治理循环 / 工具速查 / 数据诚实
```

桥的存在是因为 Veylin 插件目前只支持 stdio MCP；待支持远程条目后可删桥改为 `url` 声明。

## 测试

```bash
node --test examples/marketplace/compass-scheduler/mcp/bridge.test.cjs
```
