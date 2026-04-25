---
id: FEAT-026
title: Provider Onboarding Wizard（Provider 引导配置）
status: in-progress
phase: phase-1
owner: whiteParachute
created: 2026-04-25
updated: 2026-04-25
related:
  - ../phase-0/FEAT-003-codex-provider.md
  - ../phase-0/FEAT-006-cli-entry.md
  - ../provider-protocol.md
  - ../provider-selection.md
  - ../../docs/architecture/provider-layer.md
  - ../../docs/cli-design.md
  - ../../docs/configuration.md
---

# Provider Onboarding Wizard（Provider 引导配置）

## 1. Context / 背景

当前 Haro 的 Provider 配置仍停留在 Phase 0 最小形态：Codex Provider 通过 `OPENAI_API_KEY` 环境变量认证，`haro config` 主要用于查看合并配置，`haro model` 只能做轻量默认模型设置。用户第一次安装后，如果不知道应该设置哪个环境变量、配置写到哪里、systemd 服务如何读取密钥，就会卡在“provider unhealthy / command failed”的状态。

Hermes 等成熟 Agent 产品已经把 provider 配置做成 CLI 引导流程：发现环境、解释缺口、选择 provider/model、写入非敏感配置、提示或安全写入 secret、最后运行连通性检查。Haro 需要补齐这一层，否则 PAL 抽象虽然存在，普通用户仍无法从零完成 provider 接入。

## 2. Goals / 目标

- G1: 新增 `haro provider` 命令族，提供 provider 配置、查看、诊断、模型选择的一站式入口。
- G2: 将 Codex Provider 的首配流程做成交互式 wizard，用户无需阅读源码即可完成配置。
- G3: 保持安全边界：敏感密钥不写入普通 YAML，不在日志和终端输出中明文回显。
- G4: 统一 CLI 前台运行与 systemd/web 服务运行时的 provider 配置来源。
- G5: 为未来多 Provider 接入提供 provider schema/catalog，而不是为 codex 写死特殊分支。

## 3. Non-Goals / 不做的事

- 不在本 spec 内新增第二个真实 Provider；先把 Codex 的配置体验做完整。
- 不实现自动购买、自动生成或托管第三方 API key。
- 不把 Provider secret 明文写入 `~/.haro/config.yaml` 或项目级 `.haro/config.yaml`。
- 不实现复杂的 provider benchmark/ranking；动态重评估仍属于 Phase 2。
- 不改变 `AgentProvider` 的核心执行接口；本 spec 只补齐配置和诊断入口。

## 4. Requirements / 需求项

- R1: CLI 必须新增 `haro provider` 命令族，至少包含 `list`、`setup <id>`、`doctor [id]`、`models [id]`、`select <id> [model]`、`env [id]`。
- R2: `haro provider setup codex` 必须检查当前环境变量、全局配置、项目配置、systemd env file，并给出清晰的已配置/缺失状态。
- R3: Provider wizard 必须能写入非敏感配置，包括 `baseUrl`、`defaultModel`、`enabled`、`secretRef`、配置作用域（global/project）。
- R4: Provider wizard 必须支持安全处理 secret：默认要求用户自行设置环境变量；如支持写入 env file，文件权限必须为 `0600` 或更严格，终端和日志必须脱敏。
- R5: `haro provider models codex` 必须使用当前配置做 provider 连通性检查，并列出可用模型或给出 provider-specific remediation。
- R6: `haro provider select codex <model>` 必须更新默认 Provider/Model，并能被 `haro model`、AgentRunner 选择规则和 Dashboard config API 读取。
- R7: Provider 配置能力必须由 provider catalog/schema 描述，核心 CLI 不得通过散落的 `if providerId === 'codex'` 硬编码业务逻辑。
- R8: Wizard 必须支持 non-interactive 模式，允许 CI/脚本通过 flags 配置非敏感字段，并通过既有环境变量提供 secret。
- R9: `haro doctor` 必须能复用 provider wizard 的检查结果，输出下一条可执行修复命令。
- R10: 配置写入必须幂等；重复运行 wizard 不得重复追加配置、破坏手工配置或覆盖项目级 override。

## 5. Design / 设计要点

### 5.1 CLI command shape

```bash
haro provider list
haro provider setup codex
haro provider setup codex --scope global --model <live-model-id>
haro provider setup codex --scope project --base-url https://api.openai.com/v1 --non-interactive
haro provider doctor codex
haro provider models codex
haro provider select codex <live-model-id>
haro provider env codex
```

`haro model` 保留为轻量快捷入口；复杂 provider 配置归入 `haro provider`。

### 5.2 Provider catalog

每个 provider 暴露配置元数据：

```typescript
interface ProviderCatalogEntry {
  id: string;
  displayName: string;
  auth: {
    type: 'env';
    envVars: string[];
    secretRefKey: string;
  };
  configurableFields: ProviderConfigField[];
  defaultModel?: string;
  modelDiscovery?: 'provider-live' | 'static' | 'unsupported';
  docsUrl?: string;
}
```

Codex 首版 catalog：

- `id`: `codex`
- required env: `OPENAI_API_KEY`
- optional config: `baseUrl`, `defaultModel`
- secret ref: `env:OPENAI_API_KEY`
- model discovery: `provider-live`，通过当前 `AgentProvider.listModels()` 路径获取 live model list；Codex Provider 内部可继续复用现有 `/models` REST lister 与测试 stub。

### 5.3 Secret handling

默认安全策略：

- YAML 只保存 `secretRef: env:OPENAI_API_KEY`，不保存真实 key。
- `haro provider env codex` 输出当前运行时需要的 env 文件模板，并脱敏显示已检测到的 key。
- Phase 1 允许 wizard 在用户显式确认或传入明确 flag 时写入 `~/.config/haro/providers.env`；必须使用原子写入、`chmod 600`、不打印 secret。
- 非交互模式不得隐式写入 secret；只有显式传入 `--write-env-file` 之类的 opt-in flag 且 secret 来源明确时才允许写入受保护 env file。
- systemd 用户服务只通过 `EnvironmentFile=-%h/.config/haro/providers.env` 或用户已有 env file 读取 secret。
- project scope 允许显式引用全局 `secretRef`；项目配置不得复制真实 secret，doctor/setup 输出必须标明 secret 来源是 project-local、global-inherited、env-current-process 还是 systemd-env-file。

### 5.4 Doctor integration

Provider doctor 输出结构化问题：

```json
{
  "provider": "codex",
  "ok": false,
  "issues": [
    {
      "code": "PROVIDER_SECRET_MISSING",
      "severity": "error",
      "evidence": "OPENAI_API_KEY is not set in current process or configured env file",
      "remediation": "haro provider setup codex"
    }
  ]
}
```

### 5.5 Closed design decisions

- D1: Phase 1 允许 provider wizard 写入受保护 env file，但必须是显式 opt-in；默认仍优先输出模板和环境变量说明。
- D2: `haro provider models codex` 调用 provider live `listModels()`，不使用 catalog 静态模型列表作为默认来源；测试中通过 stub provider 保持确定性。
- D3: project scope 允许引用全局 `secretRef`，但必须显式呈现继承关系，禁止把全局 secret 复制到项目配置。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定全新用户环境且没有 `OPENAI_API_KEY`，当运行 `haro provider setup codex` 时，应清晰提示缺失 secret、说明安全配置方式，并不写入明文 secret 到 YAML。（对应 R2-R4）
- AC2: 给定用户提供有效 provider secret，当运行 `haro provider setup codex` 并选择模型后，`haro provider doctor codex` 应返回健康，`haro model` 应展示相同默认模型。（对应 R1、R5-R6）
- AC3: 给定已有项目级 `.haro/config.yaml`，当重复运行 wizard 时，应保留项目级 override，不重复追加配置。（对应 R10）
- AC4: 给定 `--non-interactive` flags 和环境变量，当运行 `haro provider setup codex --non-interactive` 时，应完成非敏感配置写入并可用于 CI。（对应 R8）
- AC5: 给定 systemd 用户服务配置了 env file，当运行 `haro provider doctor codex` 时，应能区分“当前 shell 缺 secret”和“服务 env file 可读但当前进程未加载”的状态。（对应 R2、R9）
- AC6: 给定新增 provider catalog entry，CLI provider 命令应能读取 schema 并展示基础配置项，不需要在命令层新增 provider-specific 分支。（对应 R7）

## 7. Test Plan / 测试计划

- 单元测试：provider catalog schema、secret redaction、config merge/write 幂等、provider issue code 输出。
- CLI 集成测试：`provider list/setup/doctor/models/select/env` 的成功路径和缺少 secret 路径。
- 安全测试：日志、stdout、JSON 输出不包含真实 API key；env file 权限符合要求。
- 回归测试：`haro model`、AgentRunner provider selection、Dashboard config API 继续读取同一默认 Provider/Model。
- 手动验证：在干净 `HARO_HOME` 下完成 Codex provider setup，随后运行 `haro run "ping"`。

## 8. Open Questions / 待定问题

全部已关闭：

- ~~Q1: Phase 1 是否允许 wizard 直接写入 `~/.config/haro/providers.env`，还是只生成模板并让用户手动写入？~~ **决策：允许显式 opt-in 写入。** 默认输出模板和环境变量说明；只有用户确认或传入明确 flag 时才写入 `~/.config/haro/providers.env`，并强制原子写入、`0600` 权限和脱敏输出。
- ~~Q2: `haro provider models codex` 是调用 SDK 的模型列表 API，还是 Phase 1 先使用 provider catalog 的静态模型列表？~~ **决策：调用 provider live `listModels()`。** Codex 继续复用当前 `/models` REST lister；catalog 只描述能力和字段，不作为模型列表真源。
- ~~Q3: project scope 下是否允许引用全局 secretRef，还是必须显式选择继承关系？~~ **决策：允许显式继承全局 `secretRef`。** 项目配置可以引用全局 secretRef，但不得复制真实 secret；doctor 必须显示继承来源。

## 9. Changelog / 变更记录

- 2026-04-25: Codex — 初稿，补齐 Provider 引导配置、secret 处理、model 选择与 doctor 集成规划。
- 2026-04-25: whiteParachute — 关闭 Open Questions 并批准进入实现：允许显式 opt-in 写入受保护 env file；models 使用 live `listModels()`；project scope 可显式继承全局 `secretRef`。
- 2026-04-25: Codex — 开始实现，状态更新为 in-progress；PR 合入前不标记 done。
