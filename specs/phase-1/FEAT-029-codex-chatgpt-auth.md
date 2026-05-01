---
id: FEAT-029
title: Codex ChatGPT-Subscription Auth（ChatGPT 订阅 OAuth 登录）
status: done
phase: phase-1
owner: whiteParachute
created: 2026-04-27
updated: 2026-05-01
related:
  - ../phase-0/FEAT-003-codex-provider.md
  - ./FEAT-026-provider-onboarding-wizard.md
  - ./FEAT-027-guided-setup-doctor-remediation.md
  - ../../docs/architecture/provider-layer.md
---

# Codex ChatGPT-Subscription Auth（ChatGPT 订阅 OAuth 登录）

## 1. Context / 背景

Phase 1 的 Codex Provider 仍只支持 `OPENAI_API_KEY`，但 ChatGPT Plus / Pro 订阅用户没有独立 API key，OpenAI 官方提供的入口是 `codex login` 命令——device code OAuth，凭据写到 `~/.codex/auth.json`。

实现选型：直接 ride-along 官方 codex CLI，**不**自己重新实现 OAuth。理由：
- `@openai/codex-sdk@0.121.0`（haro 已依赖）在 `dist/index.js:137,238` 用 `child_process.spawn` 调用 codex 二进制；apiKey 通过 `CODEX_API_KEY` env 传给子进程。当 apiKey 缺省时，子进程沿用 `~/.codex/auth.json` 中由 `codex login` 写入的 ChatGPT 凭据。
- 参考 hermes-agent 的纯 Python 实现需要管控 device-code 轮询、`refresh_token` 轮换、`https://chatgpt.com/backend-api/codex` 的 SSE 自适配，以及和 codex CLI 抢 refresh token 的边界——haro 不消化这套复杂度，直接复用 SDK + binary。
- 参考 keyclaw 的 UI 直接提示用户 "在宿主机运行 `codex login`"；haro 则把这一步放进 wizard 内部，用 `spawn('codex', ['login'], { stdio: 'inherit' })` 在用户当前 TTY 完成 OAuth。

## 2. Goals / 目标

- G1: `haro provider setup codex` 在 TTY 下进入交互式向导，提供 "ChatGPT 订阅" 与 "OPENAI_API_KEY" 两种登录方式。
- G2: ChatGPT 路径直接 spawn 官方 `codex login`，stdio 透传到当前 TTY；用户在 TTY 完成 OAuth；exit 0 后通过 `~/.codex/auth.json` 验证登录有效。
- G3: CodexProvider 运行时识别 `authMode = chatgpt`：跳过 `OPENAI_API_KEY` 检查，将 SDK apiKey 留空，让 SDK 子进程自己读 `~/.codex/auth.json`。
- G4: 配置层新增 `providers.codex.authMode: 'env' | 'chatgpt' | 'auto'`（默认 `auto`）；`auto` 时按本地 codex auth.json 是否存在决定行为。
- G5: `haro provider doctor codex` 与 dashboard config endpoint 暴露当前 auth 模式 / 帐号 ID / 上次刷新时间，token 永不出现在日志或 yaml。
- G6: 不向 yaml 写 token，不在 haro own 目录维护副本；refresh 由 codex CLI 自身托管。

## 3. Non-Goals / 不做的事

- 不自己实现 OAuth device-code / PKCE 流程；完全 ride-along 官方 `codex` 二进制。
- 不维护 haro own 的 codex 凭据副本；`~/.codex/auth.json` 是单一事实来源。
- 不实现 Web Dashboard 前端 UI（FEAT-030 单独立项），本 spec 只覆盖 CLI + runtime + config + doctor。
- 不实现多账号 / 多 profile；codex CLI 自身只支持一份 ChatGPT 登录，本 spec 与之对齐。
- 不替代 FEAT-026 catalog/wizard 框架；在现有 `haro provider setup codex` 内分支扩展。

## 4. Requirements / 需求项

- R1: CLI 必须在 `provider setup codex` 检测到 stdin 为 TTY 且未传 `--non-interactive` 时进入交互向导；非交互沿用现有 flag 行为，且 `--auth-mode chatgpt|env` 必须支持非交互显式声明。
- R2: 向导必须至少包含 "Sign in with ChatGPT (recommended)" 与 "Use OPENAI_API_KEY"；选 ChatGPT 时执行 R3，选 API key 时进入现有 secret-ref 流程。
- R3: ChatGPT 路径必须执行：①`spawn('codex', ['login'], { stdio: 'inherit' })`，等待退出；②退出码非 0 时不更新配置，提示重试；③成功时调用 `readLocalCodexAuth()` 读 `~/.codex/auth.json`，校验 `tokens.access_token` 存在；④将 `providers.codex.authMode = chatgpt` 写入用户选定 scope（global/project）的 yaml；⑤显示 redacted account_id。
- R4: 必须新增 helper `readLocalCodexAuth()`：读取 `${CODEX_HOME ?? ~/.codex}/auth.json`，返回 `{ hasAuth, authMode, accountId, lastRefresh }`，IO 错误返回 `hasAuth: false` 不抛。
- R5: account_id / token 的回显必须脱敏（保留前 6 后 4，中间 `…`）；refresh_token、access_token 永不出现在 stdout / log / yaml / audit。
- R6: CodexProvider runtime 必须新增 `resolveAuth()` 返回 `{ kind: 'env-api-key', token } | { kind: 'chatgpt' }`；优先级：(a) 显式 `OPENAI_API_KEY` env > (b) `authMode === 'chatgpt'` > (c) `authMode === 'auto' && readLocalCodexAuth().hasAuth` > (d) error。
- R7: `chatgpt` 模式下，SDK options 不传 `apiKey`；不要切换 `baseUrl`（SDK 自己负责，由 codex 二进制决定）。`env-api-key` 模式沿用现有逻辑。
- R8: `providers.codex.authMode` 必须出现在 `core/src/config/schema.ts` 与 `cli/src/provider-catalog.ts` 的 configurableFields；schema 校验拒绝任何 `tokens.*` 字段。
- R9: `haro provider doctor codex` 必须在两种模式下都给出报告：env 模式同现有；chatgpt 模式额外打印 `auth.json` 路径、authMode、redacted account_id、last_refresh，以及 codex 二进制是否在 PATH。
- R10: `haro provider env codex` 必须在 chatgpt 模式下显示 "ChatGPT subscription auth via ~/.codex/auth.json" 而不是 OPENAI_API_KEY 状态。
- R11: 单元测试覆盖：readLocalCodexAuth (存在/缺失/损坏/字段缺失)，redactAccountId，resolveAuth 优先级矩阵 4×3，wizard chatgpt 路径 (codex 二进制不存在 / spawn 失败 / spawn 成功但 auth 未出现 / spawn 成功 + auth 写入)，schema enum 校验，doctor 输出。
- R12: ChatGPT 登录路径默认必须执行 `spawn('codex', ['login', '--device-auth'], { stdio: 'inherit' })`，理由是 devbox / SSH 远端 / headless 环境没有本机浏览器，无法接收 localhost callback。允许通过环境变量 `HARO_CODEX_LOGIN_MODE=browser` 显式回退到无 flag 形式（本机带浏览器的人主动选择）；其它路径（auth 校验、resolveAuth、schema、yaml 字段）完全不变。

## 5. Design / 设计要点

### 5.1 模块拆分

- `packages/provider-codex/src/codex-auth.ts`（新文件）：types `LocalCodexAuth`、constants (`DEFAULT_CODEX_HOME`)、`readLocalCodexAuth`、`redactAccountId`，纯同步 IO，无外部依赖。
- `packages/provider-codex/src/codex-provider.ts`：`resolveAuth()` + `constructCodex` 分支；当 chatgpt 时不抛"OPENAI_API_KEY missing"。
- `packages/provider-codex/src/list-models.ts`：同步沿用 SDK fetcher，但 chatgpt 模式下 listModels 不可用 (SDK 内部会用 codex binary 自己；本 spec 不强行修)。
- `packages/cli/src/provider-codex-wizard.ts`（新文件）：`runProviderSetupWizard({ entry, scope, deps })`，deps 注入 prompts/spawn/readLocalCodexAuth；返回 `{ authMode, accountId? } | { cancelled: true }`。
- `packages/cli/src/index.ts`：`provider setup codex` 在交互模式下委托 wizard；非交互且 `--auth-mode chatgpt` 时仅校验 `~/.codex/auth.json`，不 spawn。
- `packages/core/src/config/schema.ts`：codex provider zod schema 增 `authMode: z.enum(['env','chatgpt','auto']).optional()`。

### 5.2 wizard UX 大纲

```
$ haro provider setup codex

? Choose Codex authentication method
  ▸ Sign in with ChatGPT (recommended)
    Use OPENAI_API_KEY (developer / org accounts)

> Sign in with ChatGPT

Launching `codex login` in this terminal — complete the OAuth flow,
then return here.

[ codex login output streams here on the same TTY ]

✓ ChatGPT login detected (account: user_2N…XaxL, refreshed 2026-04-27T11:30:00Z)
✓ Updated /home/user/.haro/config.yaml: providers.codex.authMode = chatgpt
ℹ️  Run `haro run "hello"` to verify the full path.
```

### 5.3 安全边界

- yaml 只持久化 `authMode`、`baseUrl`、`defaultModel`、`enabled`、`secretRef`；schema 显式拒绝 `tokens.*` 任何字段。
- 日志 / audit 永不打印 access_token / refresh_token；account_id 仅 redacted 形式。
- runtime 不缓存 token，每次 SDK 调用即 spawn binary，由 binary 与 `~/.codex/auth.json` 直接交互，refresh 完全交给 codex CLI 自己。
- 二次校验：wizard 在 spawn 退出后必须再读一次 `~/.codex/auth.json`，确认 `tokens.access_token` 存在；若用户 ctrl-C 提前退出 codex CLI，不应错误更新 yaml。

## 6. Acceptance Criteria / 验收标准

- AC1: TTY 下 `haro provider setup codex` 显示选择菜单；选 ChatGPT 后启动 `codex login` 子进程并接管当前 TTY。（R1, R2, R3）
- AC2: codex login 成功（exit 0 且 `~/.codex/auth.json.tokens.access_token` 存在）后，目标 yaml 的 `providers.codex.authMode` 变为 `chatgpt`，输出包含 redacted account_id。（R3, R5）
- AC3: codex login 失败（exit !=0 或 auth 未写入）时，yaml 不变，输出明确错误并提示重试。（R3）
- AC4: `authMode = chatgpt` 时，CodexProvider 不再要求 `OPENAI_API_KEY`；SDK spawn 不传 apiKey；`haro provider doctor codex` 报告 ChatGPT 模式 + redacted account 信息。（R6, R7, R9）
- AC5: 现有 env API key 用户行为完全不变；schema 校验拒绝 yaml 中写 token 字段。（R7, R8）
- AC6: 单元测试覆盖 R11 列出全部场景，无新增 npm 依赖。
- AC7: 默认调用 wizard 时，spawn 实参为 `['login', '--device-auth']`；设置 `HARO_CODEX_LOGIN_MODE=browser` 时，spawn 实参为 `['login']`，不带 flag。两种模式下成功后均调用 readLocalCodexAuth 二次校验。（R12）

## 7. Test Plan / 测试计划

- 单元：codex-auth.ts (read 存在/缺失/损坏/字段缺、redact)。
- 单元：codex-provider.ts (resolveAuth 优先级矩阵；chatgpt 模式不抛 missing；env 模式仍抛)。
- 单元：provider-codex-wizard.ts (binary 不在 PATH、spawn fail、spawn ok auth 未出现、spawn ok auth 出现、user ctrl-C)。
- 单元：schema.ts (authMode enum 校验、tokens.* 字段被拒)。
- 集成：CLI snapshot — TTY stub 下 wizard 完成、yaml 写入正确、stdout 不含 token。
- 回归：`haro provider setup codex --secret-ref env:OPENAI_API_KEY --non-interactive` 仍 OK；`haro provider doctor codex` 在两种模式下都通过。

## 8. Decision Records / 正式决策

| ID | 问题 | 决策 | 实现约束 |
| --- | --- | --- | --- |
| D1 | 自实现 OAuth 还是 spawn `codex login`？ | spawn 官方 `codex login`，stdio 透传 TTY。 | `@openai/codex-sdk` 已经 spawn codex 二进制；ride-along 该路径，不增维护。 |
| D2 | 凭据放 `~/.codex/auth.json` 还是 haro own 目录？ | `~/.codex/auth.json` 单一事实来源，不复制副本。 | refresh 由 codex CLI 托管；haro 不与 CLI 抢 refresh token 轮换。 |
| D3 | `authMode` 默认 `auto` 还是显式？ | 默认 `auto`；wizard 完成 ChatGPT 后强写 `chatgpt` 避免后续 env 残留误判。 | provider-catalog 公开 `authMode`，settings 页未来（FEAT-030）可视化。 |
| D4 | 非交互 ChatGPT 怎么办？ | `--auth-mode chatgpt --non-interactive` 仅校验 `~/.codex/auth.json` 已就绪，不 spawn；缺失则 fail。 | CI / 自动化机器需要先 `codex login` 再调 haro。 |
| D5 | 默认走 callback 还是 device-auth？ | 默认 `--device-auth`，本机带浏览器者用 `HARO_CODEX_LOGIN_MODE=browser` 回退。 | callback 在 devbox / SSH / headless 不可用；device-auth 是 codex CLI 官方 flag，是更通用的默认。 |

## 9. Changelog / 变更记录

- 2026-04-27: whiteParachute / Claude — 初稿后重构：从 device-code 自实现重构为 ride-along 官方 codex CLI；与 keyclaw UI 提示语义对齐，与 hermes 的复杂度脱钩。spec 提升为 approved 同时落实现。
- 2026-04-28: Claude/whiteParachute — 实现 R1–R11 / AC1–AC6，验证 pnpm lint/test/build/smoke 全绿，commit 82d1af3。
- 2026-04-28: Claude/whiteParachute — amend: 写入 FEAT-029 实现 commit hash 82d1af3。

- 2026-04-28: Claude/whiteParachute — post-done amendment：默认 `codex login --device-auth`，新增 R12 / AC7 / D5。原因：devbox / SSH 远端实际登录失败。commit e9d9332。
- 2026-04-28: Claude/whiteParachute — post-done amendment：让 Dashboard chat 在 ChatGPT-subscription auth 下真正可用。`list-models.ts` 在 `OPENAI_API_KEY` 缺省时 soft-fail 回退到 `~/.codex/models_cache.json`（AC6 不变，仍由 codex CLI 维护，无硬编码 slug）；`codex-auth.ts` 新增 `resolveCodexModelsCachePath` / `readLocalCodexModels`；runner 在 FE pin 住 provider+model 时短路 `resolveSelection`；新增 `GET /api/v1/providers`（enabled / authMode / defaultModel / liveModels），失败折叠成 `liveModelsFailed` 不泄漏上游路径或 env 名；ChatPage 增加可折叠 run-config 卡片与 provider/model 下拉；`@openai/codex-sdk` 0.121.0 → 0.125.0 以兼容上游 gpt-5.5。commit b348e27。
- 2026-05-01: Claude/whiteParachute — codex review 收尾修复：上一条 b348e27 的 soft-fail 没区分 `authMode`，`authMode=env` 缺 key 时也回退到本地 cache，导致 Dashboard 显示模型但运行必失败。CodexProvider 把 lister 的 `readApiKey` 包到 `resolveAuth()` 之后：`authMode=env` 缺 key → 抛错传播到 `/api/v1/providers` 触发 `liveModelsFailed`；`chatgpt`/`auto` 仍走本地 cache。同时把 `/api/v1/providers` 从 smoke 断言升级为契约测试（shape + 失败折叠不泄漏 env 名/路径）。commit 48b5158。
