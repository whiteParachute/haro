# Haro supervisor 状态表与 AgentDock 边界复核

> 日期：2026-05-21
>
> 目的：把 owner 提供的 0-10 全流程固化为当前 supervisor 状态表，避免后续口头汇报串线。
> 本文是只读复核与路线图状态，不批准删除、不触发真实 `~/.haro/evolution/` 写入。

## 0. 总判断

当前阶段不应继续扩大 self-heal，也不应直接接 daily 自动 confirm。

下一步应先补齐两件基础工作：

1. **AgentDock 边界复核**：确认哪些旧 Haro 能力已经由 AgentDock 承担，哪些仍不能删。
2. **Supervisor 状态表**：按 owner 的 0-10 全流程维护完成度和下一步。

完成这两件后，主线应回到 **feedback-driven proposal rewrite**：让 Haro 真正完成“用户 request-changes → Haro 吸收意见 → 修订 proposal → 重新提交”。

## 1. 0-10 流程当前状态

| 编号 | 主题 | 当前状态 | 已有证据 | 下一步 |
| --- | --- | --- | --- | --- |
| 0 | 统一目标和边界 | 基本完成 | `docs/planning/haro-sidecar-subtraction-and-feedback-loop.md` 已写明 Haro 是 AgentDock self-evolution sidecar；Haro 不拥有 memory，不做通用 runtime/control-plane | 保持本文作为 supervisor 口径；后续汇报按本表更新 |
| 1 | 先做减法 | 第一轮完成，未物理删除 | legacy 文档打标、旧入口 warning、sidecar/legacy 测试拆分、删除候选评审已完成 | 物理删除前必须逐项完成影响面、替代、回滚、sidecar+legacy 验证和明确批准 |
| 2 | 保留并加强核心 contract / artifact 模型 | 部分完成 | proposal / validation / approval-request / approval-decision / application / snapshot / rollback 主链路保留；`test:sidecar` 独立 | 补 `feedback/revision` artifact contract；决定 `selfHeal` metadata 是否进入 schema |
| 3 | 用户修改意见 → 修订 proposal → 重新提交 | 设计基础有，实施未完成 | FEAT-069 阻止重复；FEAT-072 写 feedbackContext；FEAT-075 spec 描述 rewrite 方向 | **下一阶段主攻**：实现 feedback-driven rewrite、revision metadata、防换汤不换药 |
| 4 | self-heal residual duplicates | on-demand 主体完成；daily 汇总未完成 | `haro self-heal duplicates --dry-run/--confirm` 已实现并通过 review；spec 已同步 confirm 契约 | 暂不做 daily auto-confirm；daily dry-run summary 可作为收尾，但不替代第 3 节 |
| 5 | proposal 生成质量 | 部分完成 | FEAT-065 policy validate、FEAT-067 frontier source、FEAT-068/074 readability lint、FEAT-069/072 feedback-aware 基础 | 补 actionable lanes：schedule-config / routing-rule / policy / L2-L3 patch plan；统一 why/how/scope/risk/test/rollback/evidence |
| 6 | 执行闭环 | L0/L1 有基础；L2/L3 未完成 | L0/L1 gated apply、snapshot、rollback、post-apply feedback 有基础 | 设计 Haro → AgentDock workspace dispatch contract；L2/L3 只生成计划，由 AgentDock workspace 执行 |
| 7 | 执行后自动反馈 | 有基础，未完整闭环 | FEAT-058 post-apply feedback 基础存在 | 系统化 applied / failed / blocked / skipped 反馈；Web lifecycle 展示；失败进入下一轮 proposal/request-changes |
| 8 | 服务生效和运维规则 | 规则需固化执行 | owner 规则：Haro Web 改动可重启 `haro-web.service`；不自动重启 `happyclaw.service`；真实 evolution 写入前必须确认 | 写入操作前显式确认；AgentDock host 修复另按 AgentDock 变更处理，不作为 Haro 默认运维路径 |
| 9 | supervisor 工作方式 | 部分执行，需要更严格 | 已使用 `send_workspace_message` 派 Haroway/Claudeway/Cocoway；已开始镜像 worker 回执 + supervisor 结论 | 后续所有回执必须先判定是否串旧任务；再输出结论、影响、证据、可合入/重启/遗漏 |
| 10A | Haro 减法盘点 | 完成 | subtraction inventory 与删除候选文档已完成 | 保持更新 |
| 10B | AgentDock 边界复核 | 本文完成首版 | 见第 2 节边界矩阵 | 后续用它驱动删除候选是否可进入物理删除 |
| 10C | feedback-driven rewrite 设计 | 设计有，未实施 | FEAT-075 spec 包含能力 2 | 拆成实现 spec / 测试 spec / 小切片实现 |
| 10D | self-heal duplicates 设计 | 设计完成；on-demand 已实现 | FEAT-075A/B 已完成；confirm 契约文档已同步 | daily dry-run 汇总待做，auto-confirm 暂缓 |
| 10E | supervisor 汇总 | 本文完成首版 | 当前状态表 | 每轮大任务后更新 |

## 2. AgentDock / Haro 边界矩阵

| 能力域 | 归属 | 当前判断 | 对 Haro 减法的影响 |
| --- | --- | --- | --- |
| session 管理 | AgentDock | Haro 不应维护会话 runtime/control-plane | Haro 旧 session/workbench 能力只能 legacy/freeze，不再扩展 |
| runner / model runtime | AgentDock | Codex/Claude/ModelHub/Trae runner 都由 AgentDock 管 | Haro provider-codex / ChatGPT auth onboarding 不再发展；物理删除前确认无 sidecar 测试依赖 |
| workspace dispatch | AgentDock | 跨 workspace 派单、回执、去重由 AgentDock host 管 | Haro 只记录 execution/application artifact；不自建 runner |
| IM / channel | AgentDock | Feishu/Telegram/Web channel 由 AgentDock channel layer 管 | Haro-owned channel packages 冻结/deprecate；删除需确认无历史测试/CLI 依赖 |
| scheduler / cron | AgentDock 为主 | Haro daily 通过 AgentDock task/MCP/CLI 被唤起；Haro 不做通用 scheduler | Haro legacy cron 入口需谨慎，先确认 daily intake 已完全由 AgentDock 承接 |
| memory / aria-memory | AgentDock / aria-memory-vault | Haro 不拥有 memory，不改 aria-memory vault | Haro MemoryFabric 不能直接删除；需先确认 mcp-tools memory 分支替代或摘除 |
| multi-agent execution | AgentDock | L2/L3 实现、测试、提交由 AgentDock workspace/worker 执行 | Haro 只产出 patch/execution plan 和记录结果 |
| proposal / validation / approval artifacts | Haro | Haro 核心职责 | 必须 keep，并加强 contract/test |
| review board | Haro Web | 只做人审入口，不做通用 dashboard | Web review board keep；旧 dashboard/control-plane 可进入删除评审 |
| application / rollback / feedback artifacts | Haro | Haro 记录执行生命周期 | 必须 keep；第 7 节还需补全 failed/blocked/skipped 反馈闭环 |
| feedback / revision | Haro | 当前缺口最大 | 下一阶段主攻；不能被 self-heal 收尾替代 |

## 3. 当前已完成的关键提交

### Haro 减法与文档

- haro-side `cdfecee` / haro `f48d73a`：沉淀 Haro sidecar 减法盘点共识
- haro-side `2f32f0d` / haro `f1301ac`：收口 Haro 减法盘点的边界阻断项
- haro-side `dd3a5c2` / haro `a1314d1`：标记 Haro 旧 workbench 文档为 legacy
- haro-side `2502cfc` / haro `d208908`：收窄 Haro 旧 workbench 入口提示
- haro-side `8f54a02` / haro `617c378`：拆分 Haro sidecar 与 legacy 测试入口
- haro-side `831c82c` / haro `c3a11a7`：评审 Haro legacy 删除候选边界

### FEAT-075 self-heal

- haro-side `cb47f33` / haro `798bdd8`：规划 Haro 自愈重复提案与反馈重写能力
- haro-side `ff38bac` / haro `250b5a5`：解释 FEAT-075 开放问题供用户决策
- haro-side `c59f23c` / haro `fbbfb03`：增加 Haro self-heal 重复提案 dry-run
- haro-side `fcd36e0` / haro `97d0cdd`：让 self-heal dry-run 明确展示可确认动作
- haro-side `787a946` / haro `bf06ea1`：强化 self-heal dry-run 的人工复核边界
- haro-side `0f504ee` / haro `ae4dd5e`：支持重复提案自愈 confirm 写入
- haro-side `2f61f8c` / haro `a2f49b5`：硬化重复提案自愈 confirm 契约测试
- haro-side `e1dcb1a` / haro `17fcf89`：记录 self-heal confirm 契约边界

### AgentDock supervisor/host 边界

- AgentDock `24f5894`：抑制短窗口重复 workspace 委托

## 4. 下一步执行顺序

### P0：停止扩大 self-heal 自动写入

- 不做 daily auto-confirm。
- 不默认动真实 `~/.haro/evolution`。
- `haro self-heal duplicates --confirm` 仍作为显式手动工具。

### P1：主攻 feedback-driven proposal rewrite

拆成三个小切片：

1. **revision metadata spec**：定义新 proposal 如何引用旧 proposal、旧 decision、用户原文、已吸收/未吸收意见、替代关系。
2. **rewrite planner**：把 request-changes direction 结构化为缩范围、补证据、改风险/回滚、合并重复、需要更多信息等类别。
3. **防换汤不换药 gate**：如果新 proposal 只引用 feedbackContext 但核心内容未变，阻止重新提交。

### P2：self-heal daily dry-run summary 收尾

只做 dry-run summary，不写 decision / proposal / blocked event。
如果 workspace delegation 继续返回旧任务，改为 Codexway 本地实现再让异构 runner review。

### P3：执行闭环与 workspace dispatch contract

在 feedback rewrite 之后再做。
避免 Haro 在 revision 还没闭环时提前扩大到 L2/L3 执行器。

## 5. 明确暂不做

- 不物理删除旧 provider/channel/memory/runtime/team 代码。
- 不做 daily auto-confirm self-heal。
- 不让 Haro 自建 runner 或 scheduler。
- 不动 aria-memory vault。
- 不自动 approve/apply/rollback 真实 proposal。
