# @veylin/desktop (Tauri 2 壳)

加载 `@veylin/web` 前端的桌面壳，并通过 **Tauri sidecar** 启动本地 BFF（`veylin-server`）。

## 架构

- **Tauri 壳**：窗口 + 静态前端（`apps/web/dist`）
- **veylin-server sidecar**：esbuild 打包的 Node 服务 + SurrealDB 嵌入式（`surrealkv://<appData>/ia`）
- **数据目录**：`~/Library/Application Support/com.veylin.app`（macOS）或 `VEYLIN_DATA_DIR` 环境变量
- **认证**：桌面模式默认 `VEYLIN_DESKTOP_AUTH=1`（单租户免登录）

## 开发

```bash
# 会自动起 web (:5174) 并尝试 npm 方式启动 server（dev 回退）
npm run -w @veylin/desktop dev
```

也可单独起 server：

```bash
VEYLIN_DATA_DIR=./data VEYLIN_DESKTOP_AUTH=1 npm run -w @veylin/server start
```

## 打包

```bash
npm run -w @veylin/desktop build
```

产物：

- macOS: `apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg`
- macOS: `apps/desktop/src-tauri/target/release/bundle/macos/*.app`

打包前会自动执行 `npm run -w @veylin/server build:sidecar`，将 `server.mjs` + 两个 MCP server 的 `.mjs` + SurrealDB 原生模块 + **内嵌官方 Node 运行时**打入 `Resources/sidecar`，`veylin-server` 二进制注册为 `externalBin`。

> 目标机**无需安装 Node**：sidecar 启动器优先使用打包内嵌的 Node 运行时启动服务（仅在内嵌运行时缺失时才回退到系统 `node`，用于开发场景）。

## 图标（首次）

```bash
npm run -w @veylin/desktop tauri icon /path/to/logo.png
```
