# FEAT-055 approve 后自动 gated apply

## 背景

ROADMAP P0 的第一段目标是补齐 L0/L1 sidecar-local artifact 的人审后自动落地链路。

当前 Haro Web approve 后只写入 `approval-decisions/<requestId>.json`，并把 human approval ref 同步到 proposal。之后不会自动发生任何动作。实际 apply 仍需要 supervisor 手动派 Haroway 执行 `haro apply --proposal-id <id>`。

这导致用户已经在审批页通过提案，但变更仍停在 validated proposal 状态。

## 目标

在 approval decision 落盘后，自动触发一次现有 gated apply：

1. decision 写入仍是主动作；
2. 仅 `decision=approve` 时尝试自动 apply；
3. 仅 L0/L1 sidecar-local artifact 进入自动 apply；
4. 直接复用已有 snapshot gate、content gate、human-review gate；
5. apply 成功或失败都写入 evolution artifact，便于 Haro Web 生命周期视图展示。

## 范围

覆盖：

- L0 `mcp-tool-config`；
- L1 `runner-profile`、`schedule-config`、`routing-rule`、`skill`；
- 现有 `haro apply` 支持的 sidecar-local target kind。

不覆盖：

- L2/L3 patch branch；
- FEAT-049 patch-branches 执行器；
- FEAT-063 失败重试状态机；
- FEAT-058 IM 通知；
- Haro Web 前端 UI。

## 触发条件

自动 apply 必须同时满足：

| 条件 | 要求 |
| --- | --- |
| 人审决定 | `decision=approve` |
| proposal level | `L0` 或 `L1` |
| target kind | sidecar-local allowlist 内 |
| validation | latest validation 存在 |
| riskVerdict | `low` 或 `medium` |
| applyEligible | `true` |
| 幂等 | proposal 尚无 `applied` 或 `failed` application 记录 |

不满足条件时不触发自动 apply，保持现状：只写 decision。

## 失败处理

- gate 阻断不回滚 decision；
- gate 阻断写入 `application_*`，状态为 `failed`，记录 gate code 和 blocking reasons；
- 自动触发不重试；
- supervisor 仍可手动执行 `haro apply --proposal-id <id>` 重试；
- 本 FEAT 不发送新的 IM 通知。

## 验收

1. approve L0/L1 且 applyEligible=true 时，自动写入 application、asset event、snapshot、rollback；
2. content gate 失败时，approval decision 保留，application 状态为 failed；
3. L2/L3 或 applyEligible=false 时，只写 decision，不触发 apply；
4. 已 applied proposal 再次触发时不会重复写入；
5. typecheck、lint、build、runner-contracts test、单元测试通过；
6. MCP `haro_run_daily_workflow` 链路不被破坏。

## 逃生口

如果自动 apply 出现异常，系统只记录 failed application，不重试、不撤销 decision。后续由 supervisor 手动检查 application gate reason，并决定是否手动 apply、回滚或要求修改提案。
