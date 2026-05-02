---
id: FEAT-041
title: 自动 eat / shit 触发器
status: draft
phase: phase-2.0
owner: whiteParachute
created: 2026-05-01
updated: 2026-05-01
related:
  - ../phase-0/FEAT-011-manual-eat-shit.md
  - ../phase-1/FEAT-022-evolution-asset-registry.md
  - ../phase-1/FEAT-023-permission-token-budget-guard.md
  - ../phase-2.0/FEAT-036-industry-intel.md
  - ../phase-2.0/FEAT-040-self-monitor.md
  - ../phase-2.5/FEAT-037-evolution-proposal.md
  - ../evolution-engine-protocol.md
  - ../evolution-metabolism.md
  - ../../docs/architecture/overview.md
  - ../../docs/planning/archive/redesign-2026-05-01.md
---

# 自动 eat / shit 触发器

## 1. Context / 背景

Phase 0 的 eat / shit（FEAT-011）只支持手动调用：`haro eat <url>` 沉淀新能力，`haro shit --scope ...` 淘汰冗余。这适合单条行为，但不适合"平台运行一段时间后周期性整理代谢"。

Phase 2.0 引入自动触发：基于 FEAT-040 Self-Monitor 与 FEAT-036 Industry Intel 的信号，**自动启动 eat 或 shit 流程的 dry-run 阶段**——只产出"建议清单 + 预览结果"，不直接落地（落地动作仍需要人审，归 Phase 2.5 Evolution Proposal）。这是 Haro 自主性的第一道阀门：**平台可以自己提出"该吃什么、该拉什么"，但人审之前不动。**

## 2. Goals / 目标

- G1: 新增 `AutoMetabolismTrigger`，按周期 / 阈值评估是否启动 eat 或 shit dry-run。
- G2: 触发条件可配置：`~/.haro/config.yaml` 中 `evolution.autoTrigger.*` 字段；提供合理默认值。
- G3: 触发结果不直接修改 platform 状态：仅产出 dry-run bundle，写入 `~/.haro/auto-trigger/<ts>/`，并注册到 FEAT-037 Evolution Proposal 队列。
- G4: 完整审计：每次触发评估、决策、产出都写 `auto_trigger_log`，可被 Self-Monitor 和 Dashboard 消费。
- G5: 安全开关：紧急可一键全局禁用（`evolution.autoTrigger.enabled: false`）。
- G6: 与 FEAT-023 Permission Guard 接合：自动触发的 dry-run 是 `evolution-internal` 权限类，不需要审批；落地（promote）需要 `write-platform` 审批，由 Phase 2.5 Evolution Proposal 执行。

## 3. Non-Goals / 不做的事

- 不直接执行 eat / shit 的写入阶段；本 spec 只做"建议产出"。
- 不引入机器学习模型决策；阈值用启发式 + 简单统计。
- 不允许触发器修改 Memory Fabric / Skills / Prompt 实质内容；只能写 `auto-trigger/` 临时目录与 proposal 队列。
- 不替代手动 eat / shit；用户随时可用手动命令覆盖。
- 不做跨实例同步；自用单机即可。

## 4. Requirements / 需求项

- R1: 新建 `packages/core/src/auto-metabolism/`，含 `trigger.ts` / `policies.ts` / `dry-run.ts` / `proposal-bridge.ts`。
- R2: 触发器注册为 FEAT-033 scheduled task：默认 cron `0 */6 * * *`（每 6 小时一次）；可通过 `evolution.autoTrigger.cron` 覆盖。
- R3: 每次触发评估 5 类政策（policies），任一命中即启动对应 dry-run：
    - **eat-from-intel**：Industry Intel `pending-review` 队列 ≥ 5 条且最旧 > 24h，触发批量 eat dry-run
    - **shit-stale-skills**：Self-Monitor `skill_hit_rate_by_agent` 中 hit_rate < 5% 且 > 90 天未用，触发 shit dry-run
    - **shit-low-value-memory**：Memory Fabric 中 `verification: pending-external` 且 > 60 天未被 query，触发 shit dry-run
    - **eat-from-failure-pattern**：Self-Monitor `failure_pattern_by_tool` 中同一 errorCode 24h 内 ≥ 20 次，触发 eat dry-run（去抓官方文档 / GitHub issue）
    - **shit-redundant-channel-state**：channel state files / sessions.sqlite > 1GB 且最近一年未访问，触发 shit dry-run
- R4: 政策阈值必须可在 `~/.haro/config.yaml` 中覆盖；未配置时使用 R3 默认值。
- R5: dry-run 不修改任何 platform 状态；产出文件结构：
    ```
    ~/.haro/auto-trigger/<ts>-<policy-id>/
    ├── manifest.json        # 政策、命中条件、候选清单
    ├── eat-bundle/          # eat 政策产物：候选条目 + 质量评估
    └── shit-candidates/     # shit 政策产物：候选清单 + dry-run 结果
    ```
- R6: 触发结果必须落到 `auto_trigger_artifacts` 表 + `~/.haro/auto-trigger/<ts>-<policy-id>/` 目录，状态字段 `bridgeStatus ∈ {pending-bridge, bridged, expired}`。
    - **Phase 2.0 实施**：仅写产物 + 表，`bridgeStatus = pending-bridge`；不依赖 FEAT-037。每次触发对应 1 条 artifact 记录，含证据链（命中政策、原始指标、dry-run 产物路径）。
    - **Phase 2.5 FEAT-037 上线后**：实现 `evolution-proposal/bridge` 模块在启动时与每次新 artifact 写入时扫描 `pending-bridge` 记录，登记为 proposal，更新 `bridgeStatus = bridged` 并回写 `proposal_id`。本 spec 只规定接口契约（artifact schema + bridge 接口），不强制要求 Phase 2.0 实现该模块。
- R7: `auto_trigger_log` 表记录每次评估：政策、是否命中、命中详情、产出路径、artifact id、`proposal_id`（Phase 2.5 后填充）、决策状态（pending / approved / rejected）。Phase 2.0 实施时 `proposal_id` 为空可接受。
- R8: 全局禁用开关 `evolution.autoTrigger.enabled: false` 必须立即生效；不允许半禁用状态。
- R9: 每个政策可独立禁用 `evolution.autoTrigger.policies.<id>.enabled: false`。
- R10: CLI 命令族：`haro auto-trigger status` / `auto-trigger run --policy <id>`（强制立即跑一次）/ `auto-trigger preview --policy <id>` / `auto-trigger logs --since <dur>`。

## 5. Design / 设计要点

### 5.1 政策接口

```ts
interface AutoTriggerPolicy {
  id: string;
  description: string;
  enabled: boolean;
  evaluate(monitor: SelfMonitor, intel: IntelService, fabric: MemoryFabric): Promise<{
    triggered: boolean;
    evidence: PolicyEvidence;
  }>;
  dryRun(evidence: PolicyEvidence): Promise<DryRunArtifact>;
}
```

每条 R3 政策实现一个 `AutoTriggerPolicy`；触发器主循环遍历所有 enabled 政策，逐一 evaluate → dryRun → 写 proposal。

### 5.2 与 FEAT-037 的桥接（双阶段实现）

**Phase 2.0**：FEAT-041 仅落 artifact + log，不直接生成 proposal。`auto_trigger_artifacts` 表是 source of truth。

```sql
CREATE TABLE auto_trigger_artifacts (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  kind TEXT NOT NULL,                -- 'eat' | 'shit'
  title TEXT NOT NULL,
  evidence TEXT NOT NULL,            -- JSON
  candidates_path TEXT NOT NULL,     -- ~/.haro/auto-trigger/<ts>-<policy>/
  impact_scope TEXT,                 -- JSON
  risks TEXT,                        -- JSON
  rollback_plan TEXT,                -- JSON
  bridge_status TEXT NOT NULL,       -- pending-bridge | bridged | expired
  proposal_id TEXT,                  -- 由 Phase 2.5 bridge 模块回填
  created_at INTEGER NOT NULL,
  bridged_at INTEGER,
  expired_at INTEGER
);
CREATE INDEX idx_auto_trigger_artifacts_status ON auto_trigger_artifacts(bridge_status, created_at);
```

未桥接的 artifact 在 30 天后标 `expired`（与 dry-run 产物 retention 同步）。

**Phase 2.5（FEAT-037 上线后）**：在 `packages/core/src/evolution-proposal/bridge.ts` 实现：

```ts
async function bridgePendingArtifacts() {
  const pending = await db.query(
    `SELECT * FROM auto_trigger_artifacts WHERE bridge_status = 'pending-bridge' AND created_at > now() - 30d`
  );
  for (const a of pending) {
    const proposal: EvolutionProposal = {
      id: ...,
      kind: a.kind === 'eat' ? 'metabolism-eat' : 'metabolism-shit',
      source: { kind: 'auto-trigger', sourceId: a.id, policyId: a.policy_id },
      title: a.title,
      evidence: JSON.parse(a.evidence),
      suggestedChanges: loadCandidates(a.candidates_path),
      impactScope: JSON.parse(a.impact_scope),
      risks: JSON.parse(a.risks),
      rollbackPlan: JSON.parse(a.rollback_plan),
      decision: 'pending',
      ...
    };
    await proposalRepository.create(proposal);
    await db.exec(
      `UPDATE auto_trigger_artifacts SET bridge_status = 'bridged', proposal_id = ?, bridged_at = ? WHERE id = ?`,
      [proposal.id, now(), a.id]
    );
  }
}
```

bridge 函数在 `web-api` 启动时跑一次回填，并在 `AutoMetabolismTrigger` 每次写新 artifact 后异步触发一次。

owner 在 Dashboard `/proposals` 页 approve 后，触发实际 eat / shit 写入；reject 则 30 天后清理 dry-run 产物。

### 5.3 dry-run 隔离

dry-run 不允许：
- 写 `~/.haro/memory/` / `~/.haro/skills/` / `~/.haro/agents/`
- 删任何文件
- 调用 Channel send / Industry Intel fetch（避免双重抓取）

dry-run 只允许：
- 读 Self-Monitor / Memory Fabric / Skills registry
- 读 Industry Intel pending-review 队列
- 写 `~/.haro/auto-trigger/<ts>/`
- 写 `auto_trigger_log` / `evolution_proposals` 表

### 5.4 与 FEAT-023 的接合

`evolution-internal` 权限类专属于 dry-run；自动批准（系统内动作）。promote 阶段（owner 决策后实际写入）走 `write-platform`，必须经过 owner 二次确认。

## 6. Acceptance Criteria / 验收标准

- AC1: 跑一次 trigger，5 个政策全部 evaluate；命中政策的 dry-run 产物在 `~/.haro/auto-trigger/<ts>-<policy>/` 出现 manifest.json（对应 R3、R5）。
- AC2 (Phase 2.0)：命中政策在 `auto_trigger_artifacts` 表写一行 `bridge_status: pending-bridge`，含 evidence / candidates_path / impact_scope / risks / rollback_plan（对应 R6 Phase 2.0 部分）。
- AC2-bridge (Phase 2.5)：FEAT-037 上线后，bridge 模块扫描 pending artifact 并登记到 proposal 队列；artifact `bridge_status` 变 `bridged`，`proposal_id` 回填（对应 R6 Phase 2.5 部分）。
- AC3: dry-run 阶段在文件系统中不修改 `~/.haro/memory/` / `~/.haro/skills/` / `~/.haro/agents/`（对应 R5、§5.3）。
- AC4: `evolution.autoTrigger.enabled: false` 配置后，下次 cron 触发不执行任何政策（对应 R8）。
- AC5: 单一政策禁用 `policies.shit-stale-skills.enabled: false` 后，其他政策仍可触发（对应 R9）。
- AC6: `haro auto-trigger preview --policy eat-from-intel` 输出候选清单但不写文件（对应 R10）。
- AC7: `auto_trigger_log` 完整记录评估、命中、产出、proposal-id 关联（对应 R7）。

## 7. Test Plan / 测试计划

- 单元测试：每条政策 evaluate 函数边界（空数据 / 阈值临界 / 多命中）；dry-run 输出 schema。
- 集成测试：模拟 Self-Monitor 数据 + Industry Intel 队列 + Memory Fabric → trigger 跑一遍 → proposal 队列 / 产物目录对账。
- 安全测试：dry-run 内部尝试写 `~/.haro/memory/` 必须拒绝；权限 sandbox 失效时 fail-fast。
- 性能：5 个政策一次评估总耗时 < 10s（生产数据规模 1 年使用历史）。
- 回归：FEAT-011 manual eat / shit 行为；FEAT-022 Asset Registry 写入路径不被 dry-run 干扰。

## 8. Open Questions / 待定问题

- Q1: 政策是否可以由用户自定义？倾向 Phase 2.0 不开放；Phase 3.0+ 视情况支持 user-defined policy。
- Q2: 多个政策同时命中时是否合并 proposal？倾向不合并，每政策一 proposal；让 owner 在 Dashboard 选择性 approve。
- Q3: dry-run 产物保留多久？倾向 30 天后自动 shit 归档；rejected 提前到 7 天。
- Q4: 是否需要"最低触发间隔"防止短时间多次触发？倾向 cron 6 小时 + 政策内部去重（同一证据指纹 24h 内不重复出 proposal）。
- Q5: 紧急 kill switch 是否有 CLI 快捷方式？倾向 `haro auto-trigger disable --reason "..."` 写 config + 写 audit log，避免直接编辑 YAML。

## 9. Changelog / 变更记录

- 2026-05-01: whiteParachute — 初稿（Phase 2.0 进化感知层批次 2）
