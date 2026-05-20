# FEAT-060 rejected approval cleanup

## 背景

Haro Web 在 FEAT-053 后可以按 latest-decision 视角查看 `undecided`、`approved`、`rejected`、`applied`、`rolled-back`。这解决了 pending 口径误导，但也让历史驳回提案长期留在 `rejected` 和 `all` 列表中。

2026-05-20 用户明确反馈：已退回提案没有继续审阅价值，会污染页面，希望能清掉。

## 现状评估

当前 active artifact 都在 `$HARO_HOME/evolution/` 下：

- `approval-requests/*.json` 是 Haro Web 列表的主索引；只要文件还在，`all` 和 `rejected` 视图就会出现该卡片。
- `approval-decisions/*.json` 决定 latest-decision；最新 decision 为 `reject` 时，生命周期状态显示为 `rejected`。
- `proposals/*.json`、`validations/*.json`、`proposal-content/<proposalId>/` 支撑详情页、证据、内容指纹和回滚前检查。
- `applications/`、`snapshots/`、`rollbacks/` 是 approve/apply 后链路，不能因为 rejected 清理误删。

污染范围主要是 Haro Web 的 `rejected`、`all` 列表和对应 lifecycle 详情。未决 `undecided` 不受影响。

## 删除语义比较

### 硬删除 JSON 文件

优点：实现最简单，页面立即变干净。

缺点：审计链断开；observation → proposal → validation → decision 追溯消失；误删后只能靠备份恢复；将来排查 dedupe 或审批问题时缺证据。

### 软归档目录

把 rejected 链路移到 `evolution/archived/rejected-approval-requests/<run>/<requestId>/`。

优点：active 列表立即干净；审计 artifact 仍在本地；误操作可以人工移回；不会改 schema；不会影响现有 Web 读路径。

缺点：需要维护归档目录；Web 默认不展示归档，需要后续另做 archive viewer。

### `archived: true` 字段

优点：文件不移动，引用路径稳定。

缺点：需要改 contract schema、Web API、前端筛选；老代码仍会读到；本轮体量和风险都更高。

## 决策

首版选择“手动 CLI + dry-run 默认 + 软归档”。

命令：

```bash
haro cleanup --rejected          # dry-run，只列候选
haro cleanup --rejected --confirm # 归档 active artifact
```

规则：

1. 仅处理 latest approval decision 为 `reject` 的 approval-request。
2. 默认 dry-run，不传 `--confirm` 不移动文件。
3. 归档 artifact：approval-request、该 request 的 approval-decisions、proposal、proposal validations、proposal-content 目录。
4. 不处理 observations/frontier signals，保留原始信号链路。
5. 如果 proposal 有 approve decision 或 application 记录，跳过，避免误删 approved/applied 链路。
6. 不在 daily workflow 里自动清理；自动策略等用户确认审计留存需求后再设计。
7. 不在首版加 Web 按钮；Web 写入口维持最小，清理由 supervisor/CLI 人工触发。

## 回滚方式

归档不是硬删除。若误归档，可从：

```text
$HARO_HOME/evolution/archived/rejected-approval-requests/<run>/<approvalRequestId>/
```

把各子目录文件移回 `evolution/approval-requests`、`approval-decisions`、`proposals`、`validations`、`proposal-content`。

## 验收

1. `haro cleanup --rejected --json` 只 dry-run，active 文件不变。
2. `haro cleanup --rejected --confirm --json` 把 rejected request 链路移出 active dirs。
3. approved、applied 或 undecided request 不被清理。
4. 命令输出 candidate、archiveRoot、archived/skipped 计数，便于 supervisor 审计。
5. 不改 AgentDock、scheduler、ModelHub、aria-memory。
6. lint、build、test、smoke 通过。
