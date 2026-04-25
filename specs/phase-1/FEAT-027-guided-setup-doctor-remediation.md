---
id: FEAT-027
title: Guided Setup & Doctor Remediation（从零引导与诊断修复）
status: done
phase: phase-1
owner: whiteParachute
created: 2026-04-25
updated: 2026-04-25
related:
  - ../phase-0/FEAT-012-setup-onboard-first-run.md
  - ./FEAT-026-provider-onboarding-wizard.md
  - ../phase-0/FEAT-006-cli-entry.md
  - ../../docs/cli-design.md
  - ../../docs/install.md
  - ../../docs/troubleshooting.md
---

# Guided Setup & Doctor Remediation（从零引导与诊断修复）

## 1. Context / 背景

FEAT-012 让 `haro setup/onboard` 具备了 Phase 0 最小首次引导能力：检查 Node、pnpm、数据目录、`OPENAI_API_KEY`，写入非敏感默认配置，并提示下一步。但这个能力仍偏“检查清单”，不能像 OpenClaw 或 Hermes 那样把用户从空机器一路带到“全局命令可用、provider 已配置、doctor 通过、第一条任务跑通、web 服务可访问”的状态。

近期使用中已经暴露同类问题：`haro` 不是全局命令时用户只看到 command not found；systemd 服务启动后浏览器无法访问时，用户需要手工排查 host/port/env；provider 未配置时 `doctor` 能报错但不能串联修复流程。Haro 需要把 setup/doctor 从“诊断工具”升级为“可恢复的配置编排器”。

## 2. Goals / 目标

- G1: 将 `haro setup` 升级为从零到可用的分阶段引导流程。
- G2: 将 `haro doctor` 升级为结构化诊断报告和安全修复建议入口。
- G3: 支持本地开发、全局 CLI、systemd user service 三种运行画像的差异化检查。
- G4: 复用 FEAT-026 provider wizard，不重复实现 provider secret/model 配置逻辑。
- G5: 提供机器可读 JSON 输出，供 Dashboard、CI 和后续自愈流程复用。

## 3. Non-Goals / 不做的事

- 不自动安装 Node、pnpm 或系统级包管理器；只检测并输出明确安装建议。
- 不自动修改 shell profile、敏感 env 文件、系统级 systemd unit 或防火墙策略。
- user-level systemd unit 可由 `haro setup --repair --profile systemd` 或 `haro doctor --fix --component web` 自动创建/更新；这是本 spec 明确允许的安全修复范围。
- 不实现远程生产环境部署平台；Phase 1 只覆盖单机 user-level 运行。
- 不替代 FEAT-026 的 provider 专项配置；setup 只负责编排和串联。
- 不实现 Channel 的完整外部平台授权；Feishu/Telegram setup 仍由 `haro channel setup` 拥有。

## 4. Requirements / 需求项

- R1: `haro setup` 必须按 stage 执行并展示进度：prerequisites、global command、data directory、configuration、provider、database、web service、channels optional、smoke test。
- R2: `haro setup` 必须支持 `--profile dev|global|systemd`，不同 profile 检查不同运行前提。
- R3: `haro setup` 必须支持 `--check` 只检查不修改，`--repair` 执行安全修复，`--json` 输出机器可读结果。
- R4: global command stage 必须能检测 `haro` 是否在 PATH 中，并给出当前安装方式下的修复建议或安全修复动作。
- R5: provider stage 必须调用 FEAT-026 的 provider setup/doctor 逻辑，不得复制 provider-specific 判断。
- R6: database/data directory stage 必须检查 HARO_HOME、目录权限、SQLite 初始化和日志目录可写性。
- R7: web service stage 必须检查 `haro web` 监听地址、端口占用、`HARO_WEB_API_KEY`、systemd user service 状态、env file 可读性。
- R8: `haro doctor` 必须输出结构化 issue：`code`、`severity`、`component`、`evidence`、`remediation`、`fixable`。
- R9: `haro doctor --fix` 只能执行低风险可逆修复，例如创建目录、补默认非敏感配置、修复用户目录权限、创建或更新 user-level systemd unit；高风险动作只输出建议。
- R10: smoke test stage 必须能执行最小 provider 调用；provider 缺失时必须提供 offline dry-run 作为“工具基本配置已完成”的通过条件，并明确区分“offline dry-run passed”“provider 未配置”“provider 调用失败”。
- R11: setup/doctor 必须幂等且可恢复；每次运行实时探测当前状态，不持久化 `~/.haro/setup-state.json` 这类 setup stage 状态文件。
- R12: 文档必须给出从空环境到可用的主路径命令，并解释 dev/global/systemd 三种 profile 的差异。

## 5. Design / 设计要点

### 5.1 Stage model

```typescript
type SetupStageId =
  | 'prerequisites'
  | 'global-command'
  | 'data-directory'
  | 'configuration'
  | 'provider'
  | 'database'
  | 'web-service'
  | 'channels'
  | 'smoke-test';

interface SetupStageResult {
  id: SetupStageId;
  status: 'ok' | 'warning' | 'error' | 'skipped' | 'fixed';
  issues: DoctorIssue[];
  nextActions: string[];
}
```

### 5.2 Doctor issue contract

```typescript
interface DoctorIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  component: 'cli' | 'config' | 'provider' | 'database' | 'web' | 'channel' | 'systemd';
  evidence: string;
  remediation: string;
  fixable: boolean;
}
```

### 5.3 Command shape

```bash
haro setup
haro setup --profile global
haro setup --profile systemd --repair
haro setup --check --json

haro doctor
haro doctor --component provider
haro doctor --component web --json
haro doctor --fix
```

### 5.4 Safe fix policy

允许自动修复：

- 创建 `~/.haro` / `~/.haro/logs` / `~/.haro/data`。
- 写入缺失的非敏感默认配置。
- 初始化 SQLite schema。
- 修复用户拥有目录的权限到更严格模式。
- 创建或更新 user-level systemd unit，并执行必要的 user-level daemon reload / enable / restart 建议或动作。

只输出建议、不自动执行：

- 安装 Node/pnpm。
- 修改 shell profile。
- 写入 provider secret。
- 开放防火墙或修改系统网络策略。
- 创建或覆盖系统级 systemd unit。

### 5.5 State model

setup/doctor 不持久化独立的 `setup-state.json`。每次运行都从文件系统、配置、Provider、SQLite、进程监听和 systemd user service 实时探测当前状态。幂等性来自“探测当前状态 → 判断 issue → 执行允许的 safe fix → 再次探测”，而不是依赖上一轮缓存。

## 6. Acceptance Criteria / 验收标准

- AC1: 给定干净 HARO_HOME，当运行 `haro setup --profile global` 时，应按 stage 展示检查结果，并在缺 provider secret 时停在 provider remediation 而不是报未捕获异常。（对应 R1-R6）
- AC2: 给定 `haro` 不在 PATH，当运行 `haro setup --check` 时，应输出 global command issue 和可执行修复建议。（对应 R3-R4）
- AC3: 给定 systemd user service 已启动但只监听 `127.0.0.1`，当运行 `haro doctor --component web` 时，应报告监听地址、端口、服务状态和访问建议；当运行允许修复的 `--fix` 命令时，应能创建或更新 user-level systemd unit。（对应 R7-R9）
- AC4: 给定缺少数据目录和 SQLite schema，当运行 `haro doctor --fix` 时，应创建目录并初始化 schema，且再次运行结果为 ok。（对应 R6、R9、R11）
- AC5: 给定 provider 未配置，当运行 smoke test stage 时，应显示 offline dry-run 通过、provider remediation 和 `haro provider setup codex` 建议；给定 provider 已配置但调用失败，应显示 `error` 并保留 provider 错误摘要。（对应 R10）
- AC6: 给定 `--json`，setup/doctor 输出应可被 JSON parser 解析，并包含所有 stage/issue/nextActions。（对应 R3、R8）
- AC7: 文档中存在从空环境到首个成功任务的主路径，并包含 dev/global/systemd profile 差异。（对应 R12）
- AC8: 给定连续两次运行 `haro setup --check --json`，第二次结果应来自实时探测且不依赖 `~/.haro/setup-state.json`；仓库和 HARO_HOME 中不应创建该状态文件。（对应 R11）

## 7. Test Plan / 测试计划

- 单元测试：stage planner、doctor issue schema、safe fix classifier、profile-specific checks。
- CLI 集成测试：`setup --check --json`、`doctor --fix`、`doctor --component web`。
- 文件系统测试：临时 HARO_HOME 下目录创建、权限修复、SQLite 初始化幂等。
- 状态测试：确认 setup/doctor 不创建 `setup-state.json`，重复运行来自实时探测。
- systemd 相关手动验证：user service active/inactive、host/port/env file 检查。
- 回归测试：FEAT-012 既有 setup/onboard 基础路径继续可用，`onboard` alias 不失效。

## 8. Open Questions / 待定问题

全部已关闭：

- ~~Q1: `haro setup --repair` 是否允许创建/更新 user-level systemd unit，还是 Phase 1 只输出 unit 模板和检查建议？~~ **决策：允许自动修复。** `--repair` / `--fix` 的语义就是执行安全修复；user-level systemd unit 属于允许范围，系统级 unit / shell profile / secret / firewall 不自动修改。
- ~~Q2: smoke test 在 provider 缺失时是否应提供 offline dry-run 作为“工具基本配置已完成”的通过条件？~~ **决策：需要提供。** provider 缺失时 offline dry-run 可证明 CLI、配置、数据目录、SQLite 等基础链路可用，同时输出 provider remediation。
- ~~Q3: 是否需要把 setup stage 结果持久化到 `~/.haro/setup-state.json`，还是每次实时探测即可？~~ **决策：实时探测即可。** 不新增 setup-state 持久文件，避免状态漂移。

## 9. Changelog / 变更记录

- 2026-04-25: Codex — 初稿，定义 setup/doctor 从零引导、结构化 remediation、安全修复边界和 profile 化检查。
- 2026-04-25: whiteParachute — 关闭 Open Questions 并批准进入实现：允许 `--repair` 自动维护 user-level systemd unit；provider 缺失时提供 offline dry-run；setup/doctor 每次实时探测，不持久化 setup-state。
- 2026-04-25: Codex — 完成实现与收尾验证：`pnpm -F @haro/cli test`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm smoke` 全部通过。
