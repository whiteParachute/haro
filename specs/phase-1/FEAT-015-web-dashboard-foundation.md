---
id: FEAT-015
title: Web Dashboard — Foundation（基础框架）
status: in-progress
phase: phase-1
owner: whiteParachute
created: 2026-04-23
updated: 2026-04-24
related:
  - ../design-principles.md
  - ../multi-agent-design-constraints.md
  - ./FEAT-013-scenario-router.md
  - ./FEAT-014-team-orchestrator.md
  - ../../roadmap/phases.md#phase-1-intelligence--场景理解与动态编排
---

# Web Dashboard — Foundation（基础框架）

## 1. Context / 背景

Haro 当前为纯 CLI 工具，通过 REPL 和命令行接口与用户交互。随着 Phase 1 的 Scenario Router（FEAT-013）和 Team Orchestrator（FEAT-014）落地，系统能力已从单 Agent 执行扩展到多 Agent 协作编排，CLI 界面已难以直观展示实时状态、分支 ledger、checkpoint 恢复节点等信息。

本 FEAT 是 Web Dashboard 系列的**第一个交付单元**，目标是搭建可运行的基础框架：前端包 + 嵌入式后端 API 服务器 + CLI 命令入口。后续 FEAT（016-018）将在此框架上逐层叠加具体业务页面。

参考架构 **keyclaw**（`/home/heyucong.bebop/self-codes/keyclaw/web/`）采用 React 19 + Vite 8 + Tailwind 4 + shadcn/ui，已验证该栈的工程可行性。

## 2. Goals / 目标

- G1: 新增 `packages/web/` 前端包并接入 pnpm workspace，技术栈为 React 19 + Vite 8 + Tailwind 4 + shadcn/ui + TypeScript
- G2: 新增 `packages/cli/src/web/` 嵌入式后端，使用 Hono 框架提供 HTTP 服务器、认证中间件和静态文件 serving
- G3: CLI 注册 `haro web` 命令，一键启动 HTTP 服务
- G4: 验证端到端可运行：浏览器访问 `http://localhost:3456` 可加载 Dashboard 占位首页
- G5: 遵循 P1（可插拔）原则——Dashboard 对核心模块零侵入，卸载后 CLI 功能不受影响

## 3. Non-Goals / 不做的事

- 不实现任何业务页面（Chat、Sessions、Status 等属于后续 FEAT）
- 不实现 WebSocket 服务（属于 FEAT-016）
- 不实现 REST API 业务路由（属于 FEAT-016~018）
- 不修改 `packages/core/` 下任何核心执行语义
- 不引入新的 leaf executor
- 不替代 CLI

## 4. Requirements / 需求项

- R1: `packages/web/` 作为 pnpm workspace 成员初始化，包含完整的 Vite 8 + React 19 + Tailwind 4 + shadcn/ui + TypeScript 配置。
- R2: `packages/web/src/` 目录结构就位，包含 main.tsx、App.tsx、基础布局组件（RootLayout、Sidebar、Header、ThemeToggle）和一个占位首页。
- R3: `packages/web/` 的 `pnpm build` 成功产出 `dist/` 目录，无类型错误和构建警告。
- R4: `packages/cli/src/web/` 初始化，包含 Hono app factory、server 启动器、auth 中间件骨架。
- R5: `haro web` 命令通过 `registerCommand()` 注册，支持 `--port` 和 `--host` 选项。
- R6: 生产模式下 Hono serve `packages/web/dist/` 静态文件；开发模式下 Vite dev server proxy 到 Hono。
- R7: Hono 后端通过 `createLogger()` 记录所有 HTTP 请求（method、path、statusCode、durationMs），禁止直接写 console.log。
- R8: 认证中间件读取 `HARO_WEB_API_KEY` 环境变量。未配置时允许无认证访问，但启动时必须打印 `WARN` 日志提示 "Dashboard running in unauthenticated mode — set HARO_WEB_API_KEY to enable auth"。

## 5. Design / 设计要点

### 5.1 前端包 `packages/web/`

```
packages/web/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── components.json
├── index.html
├── public/
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── i18n.ts
    ├── index.css
    ├── api/
    │   └── client.ts        # fetch wrapper 骨架
    ├── stores/
    │   └── auth.ts          # Zustand auth store 骨架
    ├── components/
    │   ├── ui/              # shadcn/ui 组件（Button, Card, Dialog）
    │   └── layout/
    │       ├── RootLayout.tsx
    │       ├── Sidebar.tsx
    │       ├── Header.tsx
    │       └── ThemeToggle.tsx
    ├── pages/
    │   └── HomePage.tsx     # 占位首页
    └── types/
        └── index.ts
```

**核心依赖：**
- `react@^19.0.0`, `react-dom@^19.0.0`, `react-router-dom@^7.0.0`
- `vite@^8.0.0`, `@vitejs/plugin-react@^5.2.0`
- `tailwindcss@^4.0.0`, `@tailwindcss/vite@^4.0.0`
- `zustand@^5.0.0`, `i18next@^24.0.0`, `react-i18next@^15.0.0`
- `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`
- `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tabs`

**Vite 配置要点：**
- 开发 proxy：`/api` → `http://localhost:3456`
- 构建产物：`packages/web/dist/`
- 端口：5173（dev）

### 5.2 后端 `packages/cli/src/web/`

```
packages/cli/src/web/
├── index.ts          # Hono app factory
├── server.ts         # HTTP server 启动
├── auth.ts           # API key 认证中间件
└── types.ts          # 共享服务端类型
```

**Hono 选型理由：** 体积小、TS 原生、内置 CORS/压缩/静态文件 serving，通过 `@hono/node-ws` 预留 WebSocket 扩展能力。

**Observability（P7 落地）：**
所有 HTTP 请求通过 Hono middleware 统一记录：
```typescript
app.use(async (c, next) => {
  const start = Date.now();
  await next();
  logger.info({
    method: c.req.method,
    path: c.req.path,
    statusCode: c.res.status,
    durationMs: Date.now() - start,
  });
});
```

**CLI 命令注册：**
```typescript
registerCommand(
  'web',
  (cmd) => {
    cmd
      .description('Start Haro web dashboard')
      .option('-p, --port <port>', 'HTTP port', '3456')
      .option('-h, --host <host>', 'bind address', '127.0.0.1')
      .action(async (options) => {
        const { startWebServer } = await import('./web/server.js');
        await startWebServer(app, { port: Number(options.port), host: options.host });
      });
  },
  program,
);
```

### 5.3 开发 vs 生产模式

| 模式 | 前端 | 后端 | 访问方式 |
|------|------|------|----------|
| 开发 | Vite dev server (5173) | Hono (3456) | `pnpm dev:web` 同时启动两者，前端 proxy 到后端 |
| 生产 | Hono serve `packages/web/dist/` | Hono (3456) | `haro web --port 3456` |

### 5.4 Progressive Disclosure 设计原则（P5 预埋）

基础框架阶段即确立页面信息展示原则，后续 FEAT 的页面实现必须遵循：
- 列表页默认仅展示最关键字段，详情通过点击展开或进入详情页
- 配置页面默认只展示常用项，高级配置通过"展开"切换
- 所有列表页支持服务端分页 + 客户端即时筛选

## 6. Acceptance Criteria / 验收标准

- AC1: `pnpm -F @haro/web build` 成功产出 `dist/`，无类型错误。
- AC2: `pnpm -F @haro/web lint` 通过，无 ESLint 错误。
- AC3: `haro web --port 3456` 启动后，浏览器访问 `http://localhost:3456` 可加载 Dashboard 占位首页。
- AC4: 后端 HTTP 请求日志以 pino JSON 格式输出到 `~/.haro/logs/haro.log`。
- AC5: `haro web` 启动不影响 CLI 其他命令；关闭后 CLI 功能不受影响。
- AC6: 开发模式 `pnpm dev:web` 可同时启动 Vite dev server 和 Hono API server，前端 `/api` 请求正确代理到后端。

## 7. Test Plan / 测试计划

- 构建测试：`pnpm -F @haro/web build` 在 CI 中验证
- 类型测试：`tsc --noEmit` 通过
- 启动测试：运行 `haro web`，用 `curl` 验证首页返回 200 和 HTML 内容
- 日志测试：验证 Hono middleware 正确记录请求日志

## 8. Open Questions / 待定问题

- ~~Q1: 前端主题方案使用 shadcn/ui 默认 slate 主题，还是自定义 haro 品牌色？~~ **决策：默认 slate 主题。** 品牌色延后到 Phase 2 统一设计系统时决定，避免前期反复调整。
- ~~Q2: `HARO_WEB_API_KEY` 未配置时的默认行为是开放访问还是拒绝访问？~~ **决策：开放访问 + WARN 日志。** 详见 R8 修订，保持开发友好同时提示风险。

## 9. Changelog / 变更记录

- 2026-04-23: whiteParachute — 初稿 draft
  - 从原 FEAT-015 大 spec 中拆分出 Foundation 子 FEAT
  - 聚焦前端包搭建 + Hono 后端骨架 + CLI 命令 + 静态 serving
  - 明确 Observability（P7）和 Progressive Disclosure（P5）预埋约束
- 2026-04-23: review fix — R8 增加未配置 API key 时的 WARN 日志；Open Questions 清零（主题选 slate、未配置时开放+WARN）
- 2026-04-23: dep bump — `@vitejs/plugin-react@^4.3.0` → `^5.2.0`，消除与 `vite@^8.0.0` 的 peer dependency warning
- 2026-04-24: implementation — Step 5 进入实现验证，补齐 `pnpm dev:web`、开发 `/api` proxy 验证入口与 Dashboard 模块文档
