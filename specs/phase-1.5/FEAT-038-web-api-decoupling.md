---
id: FEAT-038
title: Web API 解耦（packages/web-api 独立包）
status: draft
phase: phase-1.5
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-01
related:
  - ../phase-1/FEAT-015-web-dashboard-foundation.md
  - ../phase-1/FEAT-017-web-dashboard-system-management.md
  - ../phase-1/FEAT-028-web-dashboard-product-maturity.md
  - ../phase-1.5/FEAT-031-web-channel.md
  - ../phase-1.5/FEAT-039-cli-feature-parity.md
  - ../../docs/architecture/overview.md
  - ../../docs/planning/redesign-2026-05-01.md
---

# Web API 解耦（packages/web-api 独立包）

## 1. Context / 背景

当前 Haro 的 Web Server 寄生在 `packages/cli/src/web/`：3591 行后端代码（server.ts / 14 个 routes / WebSocket / auth-store / runtime / lib）和 CLI 包共享一棵代码树。这违反了"CLI-first + Web UI 与后端解耦"四边界约束的第二条：

- Web 后端不能独立发布、独立测试
- 前端要 import web 后端时容易耦合 CLI 内部模块
- `haro web` 命令既是入口又是实现，未来 web-api 想做 systemd 守护进程或不同进程模型时被绑死

hermes-web-ui 的做法是前端独立 repo + 后端独立 repo + 通过稳定 contract 通信。Haro 取这个思路（但仍在同一 monorepo 内）：新建 `packages/web-api/`，把 Web Server 整体迁出，CLI 退化为薄启动器。

这是 Phase 1.5 架构调整的关键一步：FEAT-031 Web Channel / FEAT-032 MCP 工具层 / FEAT-039 CLI 等价补完都依赖一个**独立的、可被 CLI 和外部 launcher 都调用**的 web-api。

## 2. Goals / 目标

- G1: 新建 `packages/web-api/` 独立 Node.js package，接管 `packages/cli/src/web/` 全部职责。
- G2: `packages/cli/` 中 `haro web` 命令退化为薄启动器：解析 CLI 参数 → 加载共享 config → fork / spawn `@haro/web-api` 服务实例。
- G3: `packages/web/`（前端 SPA）通过稳定的 HTTP / WS contract 与 web-api 通信，不再 import 任何 web-api 内部模块。
- G4: `@haro/web-api` 必须可独立 `node dist/server.js --port <p>` 启动，便于未来打 docker / systemd unit。
- G5: 前后端通过 OpenAPI 3.1 schema 描述路由契约，schema 文件在 `packages/web-api/openapi.yaml`，前端可生成 typed client。
- G6: 行为零回归：所有 FEAT-015 ~ 028 + FEAT-029/030 的 web 功能必须保持现状，URL / payload / status code 不变。

## 3. Non-Goals / 不做的事

- 不重写业务逻辑；本 spec 是搬代码 + 重组依赖，不动功能。
- 不引入 GraphQL / tRPC；继续 HTTP/JSON + WS。
- 不引入认证升级；FEAT-028 RBAC、FEAT-029 ChatGPT auth 行为照搬。
- 不强制前端用生成的 typed client；先提供 OpenAPI，client 生成是 follow-up。
- 不允许同时让 CLI 和 web-api 各自维护一份 config 解析；config loader 必须共享。
- 不部署到独立服务器；自用单机仍走 `haro web` 启动。

## 4. Requirements / 需求项

- R1: 新建 `packages/web-api/`，包含独立 `package.json`，名称 `@haro/web-api`，version 与 monorepo 同步。
- R2: 迁出全部以下文件到 `packages/web-api/src/`：`server.ts` / `routes/*.ts` / `websocket/*` / `auth.ts` / `auth-store.ts` / `runtime.ts` / `lib/*` / `logger.ts` / `types.ts`。
- R3: `packages/cli/src/web/index.ts` 退化为 ~50 行薄启动器：组装 server config → 调用 `@haro/web-api` 的 `startServer(config)` 导出。
- R4: `@haro/web-api` 必须导出至少：`startServer(config)` / `stopServer(handle)` / `createApp(config)`（暴露 Hono app 用于测试 / mount）。
- R5: 共享 config 加载抽到 `packages/core/src/config/`（已部分存在），CLI 与 web-api 都从那里加载，不允许 web-api 独立解析 YAML。
- R6: 共享 runtime / agent loading 抽到 `packages/core/`；web-api 通过依赖 `@haro/core` 调用，不允许 web-api 自己 spawn agent。
- R7: 路由前缀保持 `/api/v1/*`；URL / 参数 / status code / response shape 与现状对齐，不引入 breaking change。
- R8: `packages/web/`（前端 SPA）的 `api/client.ts` 与 `api/ws.ts` 不允许 `import` 来自 `@haro/web-api` 或 `@haro/cli` 的任何模块；只允许通过 HTTP / WS。
- R9: OpenAPI 3.1 schema `packages/web-api/openapi.yaml` 必须覆盖 `/api/v1/*` 全部路由（含 RBAC、错误码、WS endpoint），CI 校验 schema 与代码一致。
- R10: `pnpm -F @haro/web-api start` 必须能独立启动服务器；不依赖 `pnpm haro` 命令。
- R11: 单元测试 / 集成测试套件按 package 分裂：cli 包测 CLI 表面，web-api 测路由 / WS / auth；前端测试不允许 import 后端实现。

## 5. Design / 设计要点

### 5.1 目标包结构

```
packages/
├── cli/
│   ├── src/
│   │   ├── index.ts                # commander.js 路由
│   │   ├── web/
│   │   │   └── launcher.ts         # 薄启动器，~50 行
│   │   ├── channel.ts
│   │   ├── diagnostics.ts
│   │   ├── gateway.ts
│   │   ├── provider-*.ts
│   │   └── setup.ts
│   └── package.json                # 依赖 @haro/core, @haro/web-api
├── web-api/                        # 新增
│   ├── src/
│   │   ├── server.ts
│   │   ├── createApp.ts
│   │   ├── routes/
│   │   ├── websocket/
│   │   ├── auth/
│   │   ├── runtime/
│   │   └── lib/
│   ├── openapi.yaml
│   └── package.json                # 依赖 @haro/core, hono, ws, better-sqlite3
└── core/
    └── src/
        ├── config/                 # 共享 config loader
        └── ...
```

### 5.2 启动器签名

```ts
// packages/web-api/src/server.ts
export interface WebApiConfig {
  port: number;
  host: string;
  config: HaroConfig;          // 来自 @haro/core
  logger?: Logger;
  agentRegistry?: AgentRegistry;
  channelRegistry?: ChannelRegistry;
}
export function startServer(c: WebApiConfig): Promise<{ stop(): Promise<void>; address(): string }>;
export function createApp(c: WebApiConfig): Hono;
```

```ts
// packages/cli/src/web/launcher.ts
import { startServer } from '@haro/web-api';
import { loadConfig } from '@haro/core/config';
export async function runWebCommand(opts: WebCliOpts) {
  const config = await loadConfig(opts);
  const handle = await startServer({ port: opts.port, host: opts.host, config });
  // wait for SIGINT / SIGTERM, then handle.stop()
}
```

### 5.3 OpenAPI 校验

CI 阶段：
1. 路由实现侧用 `@hono/zod-openapi` 或等价方案自动生成 spec
2. 与 checked-in `openapi.yaml` 比对；漂移即 fail
3. 前端 `packages/web/` 可选地 `pnpm gen:api` 生成 typed client（非强制）

### 5.4 迁移路径

按"先复制 → 切断 → 删除"三步：
1. 把 `packages/cli/src/web/` 整树复制到 `packages/web-api/src/`，调依赖路径让两者都能跑
2. CLI 内部 `haro web` 改用 `@haro/web-api` 启动器，跑通 smoke
3. 删除 `packages/cli/src/web/` 旧文件 + 调整 import + 跑全套回归

## 6. Acceptance Criteria / 验收标准

- AC1: `pnpm -F @haro/web-api build` 与 `pnpm -F @haro/cli build` 都成功，没有循环依赖（对应 R1、R3）。
- AC2: `pnpm haro web --port 3456` 与 `pnpm -F @haro/web-api start --port 3456` 启动后，`curl /api/v1/status` 返回完全相同 payload（对应 R3、R7、R10）。
- AC3: 全部 Phase 1 既有 web E2E 用例 100% 通过，无 URL / payload / WS 行为变更（对应 R7、G6）。
- AC4: `packages/web/` 中 `grep -R "from '@haro/web-api'"` 与 `grep -R "from '@haro/cli'"` 各返回 0 行（对应 R8）。
- AC5: `openapi.yaml` 与代码注解生成的 spec diff 为空（CI 校验通过，对应 R9）。
- AC6: web-api 单元 / 集成 testset 单独运行（不带 CLI 套件）通过率 100%（对应 R11）。

## 7. Test Plan / 测试计划

- 单元测试：所有 routes 在 web-api 包内独立可测；mock `@haro/core` 接口。
- 集成测试：starServer + supertest 跑 `/api/v1/*` 全路径冒烟（auth / chat / sessions / channels / providers / users / logs / monitor / workflow / budget / memory / skills / config / status）。
- WS 测试：使用 `ws` 客户端连接 chat stream，断言事件序列。
- 回归：FEAT-016 / 017 / 018 / 019 / 024 / 025 / 028 / 029 / 030 全部 acceptance criteria 重跑。
- 启动方式 smoke：CLI 启动 / web-api 直启 / `haro doctor --component web` 三路验证。

## 8. Open Questions / 待定问题

- Q1: web-api 是否要支持以 fork 子进程方式从 CLI 启动？倾向首版用 in-process 直接 import + start（最简）；fork 模式留给后续 systemd / 资源隔离需求触发。
- Q2: OpenAPI 生成方式：`@hono/zod-openapi` 还是手写 yaml？倾向自动生成，避免 spec drift。
- Q3: 共享 logger 如何注入 web-api？倾向通过 config.logger，CLI 进程统一传入 pino 实例。
- Q4: `@haro/web-api` 是否要发布到 npm？倾向 Phase 1.5 内不发布，monorepo 内消费即可。

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute — 初稿（Phase 1.5 架构调整批次 1）
