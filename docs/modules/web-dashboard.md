# Web Dashboard 设计

## 概述

Web Dashboard 是 Haro 的可视化呈现层。FEAT-015 交付的是基础框架：`packages/web` 前端包、嵌入在 CLI 内的 Hono HTTP 服务，以及 `haro web` 启动命令。该模块遵守可插拔原则，不改动 `packages/core` 的执行语义；关闭或移除 Dashboard 后，既有 CLI 命令仍独立工作。

## 组成

| 层 | 路径 | 职责 |
| --- | --- | --- |
| 前端 | `packages/web/` | React 19 + Vite 8 + Tailwind 4 + shadcn/ui 风格组件，提供 Dashboard shell、占位首页、主题切换、API client/auth store 骨架。 |
| 后端 | `packages/cli/src/web/` | Hono app factory、API key 认证中间件、HTTP server 启停、生产静态文件服务。 |
| CLI | `packages/cli/src/index.ts` | 通过 `registerCommand()` 注册 `haro web`，支持 `--port` 与 `--host`。 |
| 根脚本 | `package.json` | `pnpm dev:web` 同时启动 Vite dev server 与 Hono API server。 |

## 开发模式

```bash
pnpm dev:web
```

- 前端：Vite dev server 固定使用 `http://127.0.0.1:5173`
- 后端：Hono API server 固定使用 `http://127.0.0.1:3456`
- Vite proxy：`/api` → `http://localhost:3456`
- 健康检查：访问 `http://127.0.0.1:5173/api/health` 会经 Vite proxy 转发到 Hono，返回 `service=haro-web` 与 `status=ok`

根脚本使用 `concurrently -k`，任一进程失败时会停止另一侧，避免开发服务器残留。

## 生产模式

```bash
pnpm -F @haro/web build
pnpm -F @haro/cli exec haro web --port 3456 --host 127.0.0.1
```

生产模式由 Hono 直接 serve `packages/web/dist/`：

- `GET /` 返回 Dashboard HTML，占位首页挂载在 `<div id="root"></div>`
- `GET /assets/*.js` 与 `GET /assets/*.css` 返回 Vite 构建产物
- `GET /api/health` 返回基础健康检查 JSON

## 认证与日志

- `HARO_WEB_API_KEY` 未配置时，Dashboard 允许本地无认证访问，并写入 WARN：`Dashboard running in unauthenticated mode — set HARO_WEB_API_KEY to enable auth`
- 配置 `HARO_WEB_API_KEY` 后，请求需携带 `x-api-key`，否则返回 `401 {"error":"Unauthorized"}`
- 所有 HTTP 请求通过 `createLogger()` 写入 `~/.haro/logs/haro.log`，日志为 pino JSON 格式，至少包含 `method`、`path`、`statusCode`、`durationMs`

## 与后续 FEAT 的边界

FEAT-015 只交付 Dashboard foundation，不包含业务页面或 WebSocket。后续 FEAT 在该基础上扩展：

- FEAT-016：Agent Interaction（Chat、Sessions、WebSocket）
- FEAT-017：System Management（Status、Settings、Channels）
- FEAT-018：Orchestration & Observability（Dispatch、Knowledge、Skills、Logs、Monitor）
- FEAT-019：Channel & Agent Management（Channel、Gateway、Agent YAML 管理）
