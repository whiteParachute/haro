---
id: FEAT-030
title: Web Dashboard Codex ChatGPT Subscription Auth UI
status: draft
phase: phase-1
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-01
related:
  - ./FEAT-017-web-dashboard-system-management.md
  - ./FEAT-026-provider-onboarding-wizard.md
  - ./FEAT-028-web-dashboard-product-maturity.md
  - ./FEAT-029-codex-chatgpt-auth.md
  - ../multi-agent-design-constraints.md
  - ../design-principles.md
  - ../../docs/architecture/provider-layer.md
  - ../../docs/modules/web-dashboard.md
  - ../../packages/cli/src/web/routes/providers.ts
  - ../../packages/cli/src/provider-codex-wizard.ts
  - ../../packages/provider-codex/src/codex-auth.ts
  - ../../packages/web/src/pages/ChatPage.tsx
---

# Web Dashboard Codex ChatGPT Subscription Auth UI

## 1. Context / 背景

FEAT-029（Codex ChatGPT-Subscription Auth）已经交付 CLI / runtime / config / doctor 路径，commit 链为 `82d1af3 → e9d9332 → b348e27 → 48b5158`。它的正式边界包括：`providers.codex.authMode: env | chatgpt | auto`、`~/.codex/auth.json` 作为 ChatGPT subscription auth 的唯一事实源、不复制 token、不自实现 OAuth device flow、默认使用 `codex login --device-auth` 适配 devbox / SSH / headless 环境。FEAT-029 §3 Non-Goals 也明确将 Web Dashboard 前端 UI 排除，留给 FEAT-030 单独立项。

当前 Dashboard 已经能通过 `GET /api/v1/providers` 读取 provider read model：`id`、`enabled`、`authMode`、`defaultModel`、`liveModels`、`liveModelsFailed`。该 read model 已被 `packages/web/src/pages/ChatPage.tsx` 的 run-config 折叠卡片消费，用于 provider / model 下拉。问题是 Dashboard 还没有任何 UI 让用户查看 Codex ChatGPT subscription auth 状态、切换 `authMode`、或从 Web 页面获得清晰的 terminal login bridge 指引；用户必须离开 Dashboard 回到 CLI 才能完成判断和操作。

本 spec 补齐这个缺口，但继续继承 FEAT-029 的安全边界：Dashboard 是 **可视化加速通道**，不是 OAuth 实现、不是 `~/.codex/auth.json` 的所有者，也不是 provider 配置的单一事实源。CLI 入口（例如 `haro provider setup codex --non-interactive`）仍必须可用。

本 spec 必须显式遵守以下约束：

- `specs/multi-agent-design-constraints.md`：本 UI 不直接改变多 Agent 编排；它只改善 Provider 认证控制面，不引入 chain-style multi-agent flow，不影响 fork-and-merge / validator 约束。
- `specs/design-principles.md`：
  - P3 single source of truth / harness product：认证事实仍由 official Codex CLI 写入的 `~/.codex/auth.json` 承担，Haro 只做 harness 读模型和配置桥接。
  - P5 progressive disclosure：认证向导不常驻打扰 ChatPage；只有用户进入 Settings 的 Codex Auth 子区并点击引导时才展开 terminal bridge。
  - P6 validation loop：用户在终端完成 `codex login --device-auth` 后，Dashboard 必须二次读取并校验 `~/.codex/auth.json` 状态，而不是相信用户已完成。
- FEAT-017 §4-§5：Settings / Status 是系统管理入口；`PUT /api/v1/config` 只写项目级 `.haro/config.yaml`；高级 UI 保持克制，不引入新的前端依赖。
- FEAT-026 §5.2：provider onboarding / config UI 应由 provider catalog / capability 描述驱动，不能把 Codex 特例散落在 CLI command 层或前端页面内部。
- FEAT-028 §5.4：Dashboard 本地用户角色层级为 `viewer < operator < admin < owner`；写操作必须按 operation class 做 RBAC，并写入 `web_audit_events`。
- FEAT-029 §5.3 与 `packages/provider-codex/src/codex-auth.ts`：token / refresh token / id token 不返回、不记录、不写 YAML；`redactAccountId` 是 account_id 脱敏的唯一实现。
- `docs/architecture/provider-layer.md`：PAL 保持 provider 可插拔；FEAT-030 只能新增 Codex 首个 dashboard auth capability 实现，不能把 provider 运行时改成 Codex-only。
- `docs/modules/web-dashboard.md`：ChatPage 的 `/api/v1/providers` contract 保持轻量，不被认证详情污染。

## 2. Goals / 目标

- G1: 在 Dashboard Settings 中新增 Codex Auth 子区，集中展示 Codex ChatGPT subscription auth 状态，并复用 FEAT-017 的系统管理入口与克制 UI 原则。
- G2: 为浏览器无 TTY 的场景提供明确的 terminal login bridge：展示 `codex login --device-auth` 指令、等待用户在终端完成登录、再由 Dashboard 二次校验 `~/.codex/auth.json`。
- G3: 允许 admin 及以上用户在 Dashboard 中切换 `providers.codex.authMode = env | chatgpt | auto`，并继续写入项目级 `.haro/config.yaml`。
- G4: 状态面板展示 `authMode`、effective auth kind、redacted account_id、last_refresh、auth.json 路径、Codex binary PATH 状态；所有脱敏由后端统一完成。
- G5: 严格继承 FEAT-029 token 安全边界：任何 HTTP response、WebSocket message、localStorage、Zustand store、日志和 audit metadata 都不得出现 `access_token` / `refresh_token` / `id_token` / `tokens.*`。
- G6: 将 authMode 切换、terminal bridge start、项目级 override reset 等显式用户动作纳入 FEAT-028 RBAC 与 `web_audit_events` 审计。
- G7: 新增 zh-CN baseline / en-US fallback i18n keys，技术标识（`authMode`、model id、status enum）允许保留英文值。
- G8: 不破坏 ChatPage 当前 `/api/v1/providers` contract；Settings 中认证状态变化后，ChatPage 通过显式 provider invalidation seam 自然刷新。
- G9: 保持 CLI / non-interactive 兜底能力；Dashboard 不是 provider setup 的唯一入口，也不替代 `haro provider setup codex --non-interactive`。

## 3. Non-Goals / 不做的事

- 不替代 CLI 入口；`haro provider setup codex`、`haro provider setup codex --non-interactive`、`haro provider doctor codex` 仍是完整可用路径。
- 不实现 Haro 自有 OAuth / device-code / PKCE flow；不代理 ChatGPT OAuth，不保存 OAuth client secret，不维护 refresh token 轮换。
- 不在 Dashboard 后端 spawn `codex login`、`codex logout` 或任何交互式 codex CLI 登录命令；登录必须由用户在自己的终端执行。
- 不复制、不编辑、不删除 `~/.codex/auth.json`；“reset”只表示项目级 Haro config override 的 reset，不表示清理 Codex CLI 凭据。
- 不向 YAML 写入 `providers.codex.tokens`、`access_token`、`refresh_token`、`id_token` 或任何 token 副本。
- 不引入新的前端依赖；UI 使用当前 React / Zustand / Tailwind / shadcn-style primitives。
- 不新增 `PATCH /api/v1/providers/:id` 作为 provider config mutation 体系；authMode 写入继续走 FEAT-017 的 `PUT /api/v1/config`。
- 不把完整 auth 状态塞回 `GET /api/v1/providers`；该 endpoint 继续服务 ChatPage run-config 下拉。
- 不重构 ChatPage 的 provider/model 选择 contract，不改变 Runner pin provider/model 的既有语义。
- 不新增多账号 / 多 profile；继续与 Codex CLI 单账号 `~/.codex/auth.json` 行为对齐。

## 4. Requirements / 需求项

> 编号后的需求是开发与测试对齐的锚点。每条 R 至少有一条 AC 覆盖。

- R1: Dashboard 必须在 Settings 页面新增 Provider / Codex Auth 子区；Status 页面最多提供跳转链接，不新增独立 `/providers/codex` 页面，不以 ChatPage modal 作为主入口。
- R2: Dashboard 必须提供 terminal login bridge 状态机：用户显式点击 start 后展示 `codex login --device-auth`、复制按钮、返回页面提示，并进入 `waiting-for-terminal-login`；后端不得 spawn `codex login`。
- R3: 后端必须新增窄只读 `GET /api/v1/providers/:id/auth-status` endpoint，用于 Dashboard auth status；Codex 首版支持，未知 provider 返回 404，已知但未声明 dashboard auth capability 的 provider 返回 501。
- R4: `auth-status` 必须是 allowlist DTO，并由后端复用 `runProviderDoctor({ checkHealth:false, checkModels:false })` / `readLocalCodexAuth()` / `redactAccountId()` 派生；不得直接返回完整 doctor result 或任何 token 字段。
- R5: `authMode` 切换必须复用 `PUT /api/v1/config` 写项目级 `.haro/config.yaml` 的 `providers.codex.authMode`；写入前必须处理 Settings dirty state，避免 whole-config 写回覆盖用户未保存改动；不新增 `PATCH /api/v1/providers/:id`。
- R6: Terminal bridge 检测必须采用手动刷新 + 有限前端轮询：只有用户进入 `waiting-for-terminal-login` 后才轮询 `auth-status`，默认每 2 秒一次，最多 60 秒；不使用 SSE / WebSocket 推送 auth.json 出现。
- R7: 状态面板必须展示 `declaredAuthMode`、`effectiveAuthKind`、`hasAuth`、redacted `accountId`、`lastRefresh`、`authFilePath`、`codexBinary.onPath`；account_id 脱敏必须由后端 `redactAccountId` 完成，FE 不得自实现脱敏。
- R8: 安全约束必须贯穿 schema、API、FE store、localStorage、WS 与 audit：任何 token 字段不得出现；UI 必须提示用户 Haro schema 显式拒绝 `providers.codex.tokens.*`，凭据只由 Codex CLI 管理。
- R9: RBAC 与审计必须对齐 FEAT-028：status read 为 `read-only`（viewer 及以上），authMode 切换 / terminal bridge start / reset project override 为 `config-write`（admin 及以上）；相关显式用户动作必须写 `web_audit_events`，metadata 不含 token。
- R10: Codex Auth UI 必须由 provider catalog / dashboard auth capability 描述驱动；Codex 是 Phase 1 首个实现，不允许把 Codex-only 分支散落在 generic Settings / ChatPage 内部。
- R11: 新增用户可见文案必须走 i18n resource，key 命名采用 `providers.codex.auth.*` 风格；`zh-CN` 为 baseline，`en-US` 为 fallback。
- R12: ChatPage 必须保持 `GET /api/v1/providers` 现有 contract，并新增显式 provider invalidation seam；Settings 保存 authMode 成功或 auth-status 从 `hasAuth=false` 变为 `hasAuth=true` 时，ChatPage 能重新 fetch `/api/v1/providers`，不得要求用户整页刷新。
- R13: Dashboard 必须保留 CLI / non-interactive 兜底提示：所有写操作仍可通过 `haro provider setup codex --non-interactive` 或项目级 config 完成；Dashboard 只是可视化加速通道。

## 5. Design / 设计要点

### 5.1 RALPLAN-DR summary

Principles:

1. **Single source of truth**：`~/.codex/auth.json` 由 official Codex CLI 拥有；Haro Dashboard 只读校验，不写、不复制、不删除。
2. **Boundary reuse before new API surface**：Settings 继续拥有项目配置写入；Provider auth status 只新增窄 read endpoint；ChatPage contract 不膨胀。
3. **Provider catalog first**：FEAT-030 允许 Codex 作为首个 dashboard auth UI 实现，但能力声明必须集中在 provider catalog / capability descriptor。
4. **Security by construction**：后端 DTO allowlist + 后端脱敏 + token 字段黑名单测试，避免 FE 侧补救式脱敏。
5. **Validation loop**：terminal login bridge 不是“点击即成功”，必须通过有限轮询/手动刷新二次校验 auth file 状态，并通过 E2E fixture 覆盖。

Decision drivers:

1. FEAT-029 已决定不自实现 OAuth，且 `codex login --device-auth` 依赖用户终端语境。
2. FEAT-017 已决定 `PUT /api/v1/config` 的项目级写边界，新增 provider-scoped write API 会制造第二条配置写路径。
3. FEAT-028 已引入本地用户、RBAC、audit；任何 Web 写操作必须纳入同一控制面。

Viable options considered:

| Option | Summary | Pros | Cons | Decision |
| --- | --- | --- | --- | --- |
| A | Settings 子区 + `auth-status` read endpoint + `PUT /config` 写 authMode + 有限轮询 | 边界最小；不破坏 ChatPage；对齐 FEAT-017/029 | config 写粒度粗，需要补 dirty-state/audit/refetch seam | **选择** |
| B | 独立 `/providers/codex` 页面 + `PATCH /api/v1/providers/:id` | provider 语义集中，字段级 patch 更自然 | 与 FEAT-017 config ownership 竞争；更容易 Codex 特例固化 | 拒绝 |
| C | ChatPage modal 承载登录引导 | 离使用场景近 | ChatPage 职责膨胀；认证配置与 run-config 耦死；不适合 P5 progressive disclosure | 拒绝 |
| D | SSE/WS 推送 auth.json 出现 | 体验实时 | 为本地文件出现引入长连接复杂度；当前场景可由 60s 有限轮询覆盖 | 拒绝 |

### 5.2 页面入口与布局

最终选择：Settings 页面新增 “Provider / Codex Auth” 子区。

- Status 页面可在 provider health / doctor card 中展示 “Configure Codex auth in Settings” 链接，但不承载交互。
- 不新增独立 `/providers/codex` 页面。Phase 1 只有 Codex 一个真实 provider，独立页面会扩大导航和权限面。
- 不以 ChatPage modal 作为主入口。ChatPage 只显示运行配置和必要的“去 Settings 修复认证”链接，不承载认证状态机。
- 子区使用现有 Card / Button / select / code block primitives；不引入新依赖。

建议 UI 分层：

1. Summary card：显示 effective status、authMode、account、lastRefresh、codex binary PATH。
2. AuthMode selector：`auto` / `chatgpt` / `env`，admin+ 可操作；viewer/operator 只读。
3. Terminal bridge panel：仅在用户点击 “Start terminal login guide” 后展开命令、复制按钮、轮询状态。
4. Safety notice：提示 Haro 不保存 token，schema 拒绝 `providers.codex.tokens.*`，清理 ChatGPT 凭据请回到 Codex CLI。
5. CLI fallback：展示 `haro provider setup codex --non-interactive --auth-mode chatgpt` 等非交互入口提示。

### 5.3 Provider catalog / capability descriptor

FEAT-030 不允许在 `SettingsPage.tsx` 或 `ChatPage.tsx` 内部散落 `if provider.id === 'codex'`。实现时应在 provider catalog 增加 dashboard auth capability 描述，例如：

```ts
interface DashboardProviderAuthCapability {
  kind: 'codex-chatgpt-auth';
  providerId: 'codex';
  authModes: readonly ['auto', 'chatgpt', 'env'];
  statusEndpoint: '/api/v1/providers/:id/auth-status';
  bridgeCommand: 'codex login --device-auth';
  supportsBackendLogin: false;
  supportsCredentialReset: false;
}
```

Codex 是 Phase 1 首个实现。未来新增 provider 时应新增 capability，而不是复制 Codex UI 分支。

### 5.4 Auth status endpoint

新增 endpoint：

```http
GET /api/v1/providers/:id/auth-status
```

权限：`read-only`（viewer 及以上）。

错误语义：

- unknown `:id`：`404 { code: "provider_not_found" }`
- known provider but no dashboard auth capability：`501 { code: "provider_auth_ui_unsupported" }`
- internal read failure：`200` with safe degraded fields where possible；不得把 raw filesystem / token parse details 放进 response body。

Codex response DTO：

```ts
interface ProviderAuthStatusDto {
  providerId: 'codex';
  displayName: string;
  declaredAuthMode: 'env' | 'chatgpt' | 'auto';
  effectiveAuthKind: 'env-api-key' | 'chatgpt' | 'none';
  hasAuth: boolean;
  detected: boolean;
  accountId: string | null;       // already redacted by backend
  lastRefresh: string | null;
  authFilePath: string;
  codexBinary: {
    name: 'codex';
    onPath: boolean;
    path?: string;
  };
  pollable: boolean;
  safety: {
    tokenFieldsReturned: false;
    schemaRejectsTokens: true;
    credentialSource: '~/.codex/auth.json';
  };
  generatedAt: string;
}
```

`effectiveAuthKind` algorithm:

1. If `declaredAuthMode === 'env'`: return `env-api-key` only when doctor reports the configured env secret is present; otherwise `none`.
2. If `declaredAuthMode === 'chatgpt'`: return `env-api-key` when env secret is present (because FEAT-029 runtime `CodexProvider.resolveAuth()` makes env API key win even under `chatgpt` mode); else return `chatgpt` when `readLocalCodexAuth().hasAuth === true`; else `none`.
3. If `declaredAuthMode === 'auto'`: return `env-api-key` when env secret is present; else `chatgpt` when local auth has `hasAuth === true`; else `none`.

> **Carry-over from 2026-05-01 Codex review (P2)**: Earlier draft of step 2 only checked `auth.json` and returned `chatgpt` / `none`, which would have caused Dashboard to display an effective auth kind that contradicts the runtime path used by `CodexProvider.resolveAuth()` when both `OPENAI_API_KEY` and `authMode === 'chatgpt'` are set. Step 2 above is the corrected algorithm — env API key always wins when present, mirroring FEAT-029 runtime precedence. Implementer must verify the resolution against `packages/provider-codex/src/codex-provider.ts:resolveAuth()` and add a regression test for the `(env-set, mode=chatgpt)` combination.

Implementation note: the route should internally reuse `runProviderDoctor({ checkHealth:false, checkModels:false })` and then project only the allowlisted fields above. It must not return full `ProviderDoctorResult.issues`, raw upstream errors, or token-shaped keys.

### 5.5 Terminal login bridge state machine

Dashboard cannot run `codex login` because the official CLI flow belongs in the user's terminal/TTY. FE state machine:

```text
idle
  ├─ admin clicks Start terminal login guide
  │    └─ POST /api/v1/providers/codex/auth-bridge/start
  │         └─ waiting-for-terminal-login
  │              ├─ poll auth-status every 2s, max 60s
  │              ├─ manual Refresh status
  │              ├─ hasAuth true -> verified
  │              └─ timeout/error -> timed-out (command remains visible)
  └─ manual Refresh status -> refreshed
```

Bridge start endpoint:

```http
POST /api/v1/providers/:id/auth-bridge/start
```

- Permission: `config-write` (admin / owner).
- Behavior: records audit and returns `{ command: "codex login --device-auth", authStatus }`.
- It must not spawn a process, open browser, write auth files, or mutate config.

Polling rules:

- Polling starts only after explicit bridge start.
- Interval: 2 seconds.
- Max duration: 60 seconds per start action.
- Automatic polling responses are not individually audited to avoid audit spam.
- Manual refresh uses `GET auth-status` and is not a write operation; it may be logged at debug level but does not create `web_audit_events` by default.

### 5.6 AuthMode config write and dirty-state strategy

AuthMode write continues through:

```http
PUT /api/v1/config
```

The payload updates only project-level `.haro/config.yaml`, consistent with FEAT-017. This is an explicit tradeoff: the endpoint writes the whole project config, not a provider-scoped patch. FEAT-030 accepts this to avoid a second provider mutation API, but requires the following guardrails:

- Settings auth subcomponent must track dirty state for common config form and raw YAML editor.
- If raw YAML or common config has unsaved local edits, authMode controls and reset controls are disabled and show a localized warning: save/discard existing Settings edits first.
- When authMode save is allowed, the FE must first call `loadConfig()` / fetch latest server config, merge only `providers.codex.authMode`, then call `saveConfig({ config: latestPatchedConfig })`.
- After save success, FE must reload config and auth-status, then dispatch provider invalidation event.
- Reset project override means removing `providers.codex.authMode` from project config or setting it back to `auto` according to existing config editor semantics; it never deletes `~/.codex/auth.json`.

### 5.7 RBAC and audit design

Roles:

| Action | Endpoint / UI action | Minimum role | WebOperationClass |
| --- | --- | --- | --- |
| View auth status | `GET /api/v1/providers/:id/auth-status` | viewer | `read-only` |
| Start terminal bridge | `POST /api/v1/providers/:id/auth-bridge/start` | admin | `config-write` |
| Change authMode | `PUT /api/v1/config` with `providers.codex.authMode` diff | admin | `config-write` |
| Reset project authMode override | `PUT /api/v1/config` removing/resetting project authMode | admin | `config-write` |

FE must hide or disable write controls for viewer/operator and explain required role. Backend remains authoritative and returns 403 for insufficient role.

Audit requirements:

- FEAT-030 must extend backend config write path so provider-auth-related config diffs write `web_audit_events`; current config route has no audit, so this is part of the implementation scope.
- Denied bridge/config actions should record audit when an authenticated actor is available; if existing middleware returns before route code, implementation may add an audited guard wrapper for these endpoints.
- Audit is recorded for explicit user actions, not for automatic polling.

Audit payload schema:

```ts
interface ProviderAuthAuditMetadata {
  providerId: 'codex';
  providerOperationClass:
    | 'auth-mode-change'
    | 'chatgpt-login-bridge'
    | 'auth-mode-reset-project-override';
  previousAuthMode?: 'env' | 'chatgpt' | 'auto' | null;
  nextAuthMode?: 'env' | 'chatgpt' | 'auto' | null;
  scope: 'project';
  outcome: 'allowed' | 'denied' | 'failed';
  reason?: string;
  hasAuthBefore?: boolean;
  hasAuthAfter?: boolean;
  accountId?: string | null; // redacted only
  authFilePath?: string;
  requestId?: string;
}
```

Suggested `web_audit_events` values:

- `operation_class`: `config-write`
- `operation`: `providers.codex.auth-mode.update` / `providers.codex.chatgpt-login-bridge.start` / `providers.codex.auth-mode.reset-project-override`
- `target_type`: `provider`
- `target_id`: `codex`
- `metadata_json`: `ProviderAuthAuditMetadata`

Forbidden in audit metadata: `tokens`, `access_token`, `refresh_token`, `id_token`, raw auth JSON, raw environment secret values.

### 5.8 Security and data-flow constraints

Data flow:

```text
codex CLI terminal login
  -> ~/.codex/auth.json (owned by codex CLI)
  -> readLocalCodexAuth() / runProviderDoctor()
  -> GET /api/v1/providers/codex/auth-status allowlist DTO
  -> Settings Codex Auth UI state
  -> optional PUT /api/v1/config for authMode only
  -> ChatPage invalidates /api/v1/providers read model
```

Hard rules:

- FE must not parse or store raw `auth.json`.
- FE must not implement account_id masking; it displays the backend-provided `accountId` as already-redacted.
- API client / Zustand stores / localStorage / WebSocket messages must not contain token-shaped keys. The only allowed localStorage keys remain UI preferences such as locale and ChatPage run-config selection; no auth-status payload should be persisted to localStorage.
- UI safety notice must say: “Haro 不保存 ChatGPT token；`providers.codex.tokens.*` 会被 schema 拒绝；如需退出或清理 ChatGPT 登录，请在终端使用 Codex CLI。”
- `authFilePath` may be displayed because the user explicitly needs to know which local auth file Dashboard is validating. It must not be used to read arbitrary paths; endpoint resolves it internally via Codex helper only.

### 5.9 i18n keys

新增 key 按 `providers.codex.auth.*` 命名。首批 keys：

- `providers.codex.auth.title`
- `providers.codex.auth.description`
- `providers.codex.auth.status.title`
- `providers.codex.auth.status.declaredAuthMode`
- `providers.codex.auth.status.effectiveAuthKind`
- `providers.codex.auth.status.hasAuth`
- `providers.codex.auth.status.accountId`
- `providers.codex.auth.status.lastRefresh`
- `providers.codex.auth.status.authFilePath`
- `providers.codex.auth.status.codexBinary`
- `providers.codex.auth.mode.label`
- `providers.codex.auth.mode.auto`
- `providers.codex.auth.mode.chatgpt`
- `providers.codex.auth.mode.env`
- `providers.codex.auth.mode.save`
- `providers.codex.auth.mode.resetProjectOverride`
- `providers.codex.auth.bridge.title`
- `providers.codex.auth.bridge.start`
- `providers.codex.auth.bridge.commandLabel`
- `providers.codex.auth.bridge.copyCommand`
- `providers.codex.auth.bridge.waiting`
- `providers.codex.auth.bridge.verified`
- `providers.codex.auth.bridge.timedOut`
- `providers.codex.auth.bridge.refresh`
- `providers.codex.auth.security.title`
- `providers.codex.auth.security.noTokens`
- `providers.codex.auth.security.schemaRejectsTokens`
- `providers.codex.auth.cliFallback.title`
- `providers.codex.auth.cliFallback.nonInteractive`
- `providers.codex.auth.rbac.requiresAdmin`
- `providers.codex.auth.dirtySettingsWarning`

技术 enum 值（`auto`、`chatgpt`、`env`、`env-api-key`）可保留英文，但要有中文标签或 tooltip。

### 5.10 ChatPage refresh seam

`GET /api/v1/providers` 不新增 auth-status 字段，继续返回 ChatPage 需要的轻量 provider/model list。

新增 FE 事件约定：

```ts
type ProvidersInvalidatedEventDetail = {
  source: 'settings.codex-auth';
  providerId: 'codex';
  reason: 'auth-mode-changed' | 'chatgpt-auth-verified';
  at: string;
};

window.dispatchEvent(new CustomEvent('haro:providers-invalidated', { detail }));
```

触发点：

- authMode save 成功后：`reason='auth-mode-changed'`
- terminal bridge polling / manual refresh 发现 `hasAuth` 从 `false` 变成 `true` 后：`reason='chatgpt-auth-verified'`

ChatPage must:

- extract provider loading into reusable `refreshProviders()` logic;
- subscribe to `haro:providers-invalidated` and refetch `/api/v1/providers` when `providerId === 'codex'`;
- optionally refetch on window focus / visibility regain with a small throttle (for example no more than once every 30 seconds);
- keep existing submit behavior and disabled reason semantics.

### 5.11 Decision Records / 正式决策

| ID | 问题 | 决策 | 理由 / 后果 |
| --- | --- | --- | --- |
| D1 | 入口放 Settings、独立页还是 ChatPage modal？ | 放 Settings 的 Provider / Codex Auth 子区。 | 复用 FEAT-017 系统管理边界和 P5 progressive disclosure；ChatPage 不膨胀。 |
| D2 | Dashboard 是否运行 `codex login`？ | 不运行；只展示 `codex login --device-auth` bridge。 | FEAT-029 已决定 OAuth 属于官方 CLI；Web 后端无可靠 TTY。 |
| D3 | 检测 auth.json 用 `/providers` 还是新 endpoint？ | 新增窄只读 `GET /api/v1/providers/:id/auth-status`。 | 保持 `/api/v1/providers` 轻量 contract，避免污染 ChatPage。 |
| D4 | auth-status 直接读 auth helper 还是复用 doctor？ | 优先复用 `runProviderDoctor({ checkHealth:false, checkModels:false })`，再投影 DTO。 | 避免 CLI doctor 与 Dashboard 诊断漂移。 |
| D5 | authMode 写入用 `PUT /config` 还是 `PATCH /providers/:id`？ | 用 FEAT-017 `PUT /api/v1/config` 写项目级 config。 | 接受 whole-config 写回 tradeoff，避免第二套 provider mutation API。 |
| D6 | whole-config 写回如何防覆盖？ | dirty Settings 时禁用 authMode 写；保存前重新 fetch latest config 再 merge patch。 | 降低整份 config 写回的误覆盖风险。 |
| D7 | 轮询还是 SSE/WS？ | 用户显式开始 bridge 后，FE 2s/次、最多 60s 有限轮询 + 手动刷新。 | 本地文件出现不值得引入 WS/SSE 复杂度。 |
| D8 | reset 是否清理 `~/.codex/auth.json`？ | 不清理；只 reset 项目级 `authMode` override。 | `auth.json` 属于 Codex CLI，Haro 不拥有凭据生命周期。 |
| D9 | RBAC/audit 如何落地？ | read-only 给 viewer+；bridge/authMode/reset 需 admin+，写 `web_audit_events`。 | 对齐 FEAT-028；audit metadata 不含 token。 |
| D10 | provider catalog 约束如何满足？ | 通过 dashboard auth capability 描述驱动 UI；Codex 只是首个实现。 | 避免把 Codex 特例焊死在通用前端。 |
| D11 | ChatPage 如何同步？ | 保持 `/providers` contract，通过 `haro:providers-invalidated` + focus refetch 重新读取。 | 不破坏 ChatPage，但消除状态不同步。 |
| D12 | Dashboard 与 CLI 关系？ | Dashboard 是 visual accelerator；CLI/non-interactive 仍可完整操作。 | 保留自动化和 headless 运维路径。 |

### 5.12 Pre-mortem / 风险预案

1. **风险：whole-config 写回覆盖用户未保存的 Settings/YAML 编辑。**
   - 缓解：authMode 控件在 dirty state 禁用；保存前 fetch latest server config 并最小 patch；测试覆盖 dirty raw YAML 时按钮不可用。
2. **风险：token / account path 泄漏到 JSON、store、日志、audit 或截图。**
   - 缓解：后端 allowlist DTO；token-shaped key regression test；audit metadata schema；Playwright 截图和网络 payload 扫描不得含 `access_token` / `refresh_token` / `id_token`。
3. **风险：用户终端登录成功，但 Settings 或 ChatPage 仍显示旧状态。**
   - 缓解：60s 轮询 + manual refresh；`hasAuth false -> true` 派发 provider invalidation；ChatPage 订阅并 refetch；E2E fixture 注入 auth.json 验证刷新链。
4. **风险：Codex-only UI 变成未来 provider 的硬编码障碍。**
   - 缓解：provider catalog capability descriptor；unsupported provider 返回 501；测试确认非 Codex provider 不渲染 Codex 文案。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定已登录 viewer 访问 Settings，当页面加载完成时，应看到 Codex Auth 只读状态卡、authMode 当前值、terminal bridge 说明入口但看不到可执行保存/start/reset 按钮。（对应 R1、R9）
- AC2: 给定 Status 页面显示 provider health，当 Codex 认证需要配置时，页面只提供跳转到 Settings Codex Auth 子区的链接，不弹出 modal、不新增 `/providers/codex` 主页面。（对应 R1）
- AC3: 给定 admin 点击 “Start terminal login guide”，后端收到 `POST /api/v1/providers/codex/auth-bridge/start` 后只返回 `codex login --device-auth` 和当前 authStatus，并写 audit；进程列表和测试 spy 证明未 spawn `codex login`。（对应 R2、R9）
- AC4: 给定 bridge 已进入 `waiting-for-terminal-login`，前端每 2 秒调用一次 `GET /api/v1/providers/codex/auth-status` 且最多 60 秒；超时后停止自动轮询并保留手动 Refresh 按钮。（对应 R2、R6）
- AC5: 给定未知 provider id 调用 `GET /api/v1/providers/unknown/auth-status`，返回 404 `provider_not_found`；给定已知但不支持 dashboard auth capability 的 provider，返回 501 `provider_auth_ui_unsupported`。（对应 R3、R10）
- AC6: 给定 Codex auth file 存在、缺失、损坏三种情况，`GET /api/v1/providers/codex/auth-status` 均返回 allowlist DTO；response 中不包含 `tokens`、`access_token`、`refresh_token`、`id_token`、raw auth JSON 或 raw parse stack。（对应 R3、R4、R8）
- AC7: 给定 `authMode=auto` 且 `OPENAI_API_KEY` 存在，`effectiveAuthKind` 为 `env-api-key`；给定 env 缺失但 `readLocalCodexAuth().hasAuth=true`，为 `chatgpt`；两者都缺失时为 `none`。（对应 R4、R7）
- AC8: 给定 admin 在 Settings 中将 authMode 切换为 `chatgpt` 并保存，项目级 `.haro/config.yaml` 的 `providers.codex.authMode` 更新为 `chatgpt`，全局 config 和 `~/.codex/auth.json` 不变。（对应 R5）
- AC9: 给定 Settings common config 或 raw YAML 有未保存 dirty state，当用户尝试切换 authMode 时，控件 disabled 并显示 `providers.codex.auth.dirtySettingsWarning`，不会发起 `PUT /api/v1/config`。（对应 R5）
- AC10: 给定 viewer/operator 直接调用 authMode save 或 bridge start，后端返回 403；给定 admin/owner 调用同一动作，返回成功或业务错误；写操作均按规定写入或尝试写入 audit。（对应 R9）
- AC11: 给定 authMode update / bridge start / reset project override 成功或失败，`web_audit_events` 中存在 target=`provider:codex` 的事件，metadata 包含 actor、providerOperationClass、outcome、reason（如有）、previous/next authMode（如适用），且不包含 token 字段。（对应 R9）
- AC12: 给定状态面板展示 account_id，页面显示的是后端返回的 redacted accountId；FE 代码中不存在自实现 account_id mask 函数。（对应 R7）
- AC13: 给定 schema 或 config payload 中出现 `providers.codex.tokens.*`，保存失败并显示安全提示；UI 文案明确 Haro 不保存 ChatGPT token。（对应 R8）
- AC14: 给定 locale 为 zh-CN，Codex Auth 子区所有用户可见标题、按钮、错误、空态、安全提示均来自 `providers.codex.auth.*` i18n key；切换 en-US 时有 fallback 文案。（对应 R11）
- AC15: 给定 ChatPage 已挂载，当 Settings 保存 authMode 成功并派发 `haro:providers-invalidated` 时，ChatPage 重新请求 `/api/v1/providers`，provider/model 下拉 contract 保持原字段。（对应 R12）
- AC16: 给定 terminal bridge 轮询发现 `hasAuth` 从 false 变 true，Settings 显示 verified 状态并派发 `haro:providers-invalidated`；ChatPage 无需整页刷新即可拿到新的 provider read model。（对应 R6、R12）
- AC17: 给定用户选择 reset project authMode override，项目级 config 中仅 authMode override 被移除或回到 `auto`；`~/.codex/auth.json` 未被删除，未调用 `codex logout`。（对应 R5、R8、R9）
- AC18: 给定用户不使用 Dashboard，仍可通过 `haro provider setup codex --non-interactive --auth-mode chatgpt` 或手工项目级 config 完成同等 authMode 配置；Dashboard 文案明确它不是唯一入口。（对应 R13）

## 7. Test Plan / 测试计划

### 7.1 Unit tests

- FE store / hook 纯逻辑：
  - Codex Auth 状态机：`idle`、`waiting-for-terminal-login`、`verified`、`timed-out`、`error`。
  - 2s interval / 60s max polling 的 fake timer 测试。
  - dirty Settings state 下 authMode 控件 disabled。
  - role gating：viewer/operator 只读，admin/owner 可操作。
  - provider invalidation event helper：payload shape、reason 枚举、ChatPage subscription cleanup。
- 后端 DTO shaping：
  - `ProviderDoctorResult -> ProviderAuthStatusDto` allowlist 映射。
  - `effectiveAuthKind` 矩阵：`env/chatgpt/auto × env present/missing × auth has/missing`。
  - token-shaped keys deep scan：DTO 不含 `tokens/access_token/refresh_token/id_token`。
- i18n：
  - `providers.codex.auth.*` keys 在 zh-CN 和 en-US 中都有值。
  - 新 UI 主路径无硬编码用户可见文案（技术 enum allowlist 除外）。

### 7.2 Backend contract tests

扩展现有 web contract test 风格（例如 `web-feat018.test.ts` / FEAT-029 follow-up providers contract）：

- `GET /api/v1/providers/codex/auth-status`：
  - auth file exists / missing / malformed；
  - Codex binary on PATH / missing；
  - response status 200 and DTO shape stable；
  - response 不泄漏 env var name、token、raw filesystem read error stack。
- `GET /api/v1/providers/:id/auth-status` error cases：unknown provider 404；unsupported provider 501。
- `POST /api/v1/providers/codex/auth-bridge/start`：
  - admin success returns command and audit event；
  - viewer/operator 403；
  - spawn mock / process spy proves no `codex login` subprocess is created。
- `PUT /api/v1/config` authMode diff：
  - admin writes project `.haro/config.yaml` only；
  - global config untouched；
  - `~/.codex/auth.json` untouched；
  - `providers.codex.tokens.*` rejected；
  - audit event written for update/reset success/failure and contains no token keys。
- Audit denied behavior：authenticated actor denied on bridge/config action should create a denied audit event where the audited guard can observe actor; anonymous/unauthenticated denial may remain normal 401/403 without actor metadata.

### 7.3 Frontend component/integration tests

- SettingsPage renders Codex Auth card from capability descriptor, not from scattered Codex branch in generic page.
- Viewer/operator see read-only status and localized required-admin message.
- Admin can select `auto/chatgpt/env`, save, reload config/status, and dispatch invalidation event.
- Terminal bridge start displays command, copy button, waiting UI, timeout UI, and verified UI.
- ChatPage refetches providers on `haro:providers-invalidated` and on throttled focus regain; existing provider/model dropdown behavior remains unchanged.

### 7.4 Playwright CLI real-browser E2E smoke

Run a local Haro Web service and real browser:

1. Start test instance with isolated `HARO_HOME`, project root, database, and `CODEX_HOME` fixture directory.
2. Bootstrap/login as admin.
3. Navigate to Settings → Provider / Codex Auth.
4. Verify initial state: no ChatGPT auth, command guide available, no token text in DOM.
5. Click Start terminal login guide; assert command `codex login --device-auth` is visible and screenshot is saved as evidence.
6. Simulate “user completed terminal login” by writing fixture `${CODEX_HOME}/auth.json` with a fake token and account id; UI must never display the fake token.
7. Wait for polling/manual refresh to verify `hasAuth=true`, redacted account, lastRefresh, authFilePath, codex PATH status.
8. Save `authMode=chatgpt`; assert project `.haro/config.yaml` changed and audit row exists.
9. Navigate to ChatPage without full page reload; assert `/api/v1/providers` is refetched and run-config card still renders provider/model dropdown with existing contract.
10. Capture screenshot evidence for Settings verified state and ChatPage run-config state.

### 7.5 Observability / security verification

- Network payload scan in E2E: no `access_token` / `refresh_token` / `id_token` / `tokens` in responses, requests, WS frames, or localStorage.
- `web_audit_events` inspection: required provider auth events present, metadata token-free, actor and role populated for session users.
- Log scan: `~/.haro/logs/haro.log` contains request summaries but no token-shaped values or raw auth JSON.
- Regression: existing `/api/v1/providers` tests still pass and prove `liveModelsFailed` remains generic.

## 8. Open Questions / 待定问题

> 本 draft 将用户要求的关键问题先行关闭；status 升为 `approved` 前仍需 owner 审阅确认。

| ID | Question | Decision in this draft | Rationale |
| --- | --- | --- | --- |
| Q1 | authMode 写入 scope 是 global 还是 project？ | **project（默认且唯一 Dashboard 写入 scope）**。 | FEAT-017 `PUT /api/v1/config` 只写项目级 `.haro/config.yaml`；global 写入仍归 CLI。 |
| Q2 | 是否新增 `GET /api/v1/providers/:id/auth-status`，还是把字段塞回 `GET /api/v1/providers`？ | **新增窄只读 endpoint**。 | 保持 ChatPage `/providers` contract 轻量，避免认证详情污染 run-config read model。 |
| Q3 | 桥接体验使用 SSE/WS 主动推送 auth.json 出现，还是 FE 轮询？ | **FE 有限轮询 + 手动刷新**。 | 用户显式开始 bridge 后 2s/次最多 60s；本地文件出现不值得新增 WS/SSE 复杂度。 |
| Q4 | 切回 env 模式时是否清理 `~/.codex/auth.json`？ | **默认不清理**。 | `auth.json` 属于 Codex CLI；Haro 只切换项目级 authMode，不调用 `codex logout`。 |
| Q5 | `authFilePath` 是否可展示？ | **可展示给已认证 read-only 用户**。 | 用户需要知道 Dashboard 正在验证哪个 Codex auth file；内容仍不包含 token，路径由后端 helper 固定解析。 |
| Q6 | Provider catalog 约束如何处理？ | **新增 dashboard auth capability，Codex 为首个实现**。 | 满足 FEAT-026 / PAL 可插拔原则，避免 Codex 特例散落在通用 UI。 |
| Q7 | `PUT /api/v1/config` 的 whole-config 写回如何避免覆盖？ | **dirty state 禁用 + save 前 fetch latest server config + minimal patch + save 后 reload**。 | 接受 FEAT-017 写路径，同时降低误覆盖风险。 |

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute / Codex — 起草 FEAT-030 draft：定义 Settings Codex Auth UI、terminal login bridge、auth-status endpoint、authMode project-scope config write、RBAC/audit、安全边界、i18n、ChatPage invalidation、测试计划与已关闭 Open Questions；本轮只起草 spec，不进入实现。
