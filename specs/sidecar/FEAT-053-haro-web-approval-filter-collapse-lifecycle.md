# FEAT-053 Haro Web 审批筛选、折叠与生命周期视图

## 背景

Haro Web 当前已经能承接 Haro 自动生成的 approval request，但审批页仍接近“单列表”：

- 只能按 pending / decided / all 粗筛，且容易误用 contract 层 `pendingCount` 口径；
- 每张提案卡片默认展开，信息密度高，长文本容易挤压布局；
- 用户通过提案后，看不到后续 apply、snapshot、asset event、rollback 是否已经落盘。

用户希望 Haro Web 只是 sidecar proposal review 看板，不承担调度、聊天、workspace runtime 或控制面。本特性只改看板可读性和只读数据拼装。

## 范围

只包含：

1. Haro Web 前端审批页；
2. Haro Web API 必要的只读 GET 数据拼装；
3. 前端状态筛选、卡片折叠和生命周期展示。

不包含：

- 不改 approval / validate / propose 核心逻辑；
- 不新增写入路径；
- 不改 AgentDock、scheduler、ModelHub、aria-memory；
- 不 approve / apply / rollback 任一提案；
- 不修 FEAT-052 描述 lint。

## 设计方向（frontend-design）

采用“审计工作台”风格：深色英雄区、账本式状态筛选、紧凑折叠卡片、纵向生命周期轨道。目标是让审批人先看状态和边界，再展开读细节，避免把所有说明一次性铺满页面。

## 目标

### B1 按状态筛选

- 列表页支持多选状态：`undecided`、`approved`、`rejected`、`applied`、`rolled-back`；
- 前端不使用 `haro status.pendingCount`；
- 以 latest-decision 视角计算状态：无 decision 为 `undecided`，有 reject/request-changes 为 `rejected`，approve 后再结合 application / asset event / rollback 得到 `approved`、`applied` 或 `rolled-back`；
- 顶部计数条和筛选器使用同一状态口径。

### B2 提案卡片收起展开

- 卡片默认收起；
- 收起态仅显示 title、scope 第一行、risk verdict、latest status、createdAt；
- 展开态显示 whyChange、howChange、scope、expectedBenefits、regressionRisks、rollbackPlan、reviewerInstruction、evidenceRefs、proposal contentHash、validation id；
- 展开状态存入 sessionStorage；
- 长文本使用稳定折行，避免溢出边框。

### B3 通过后的生命周期视图

- 对已 approve 的提案展示 decision、application、applied event、snapshot、rollback；
- 用户能看出提案停在哪一环，是否已经写入 asset，是否可回滚或已回滚；
- apply 阻断时展示 gate code 和 reason；
- 只读 API 拼装本地 artifact，不引入新写入动作。

## 验收标准

1. `GET /api/v1/approval-requests?status=all` 返回每条 request 的 `lifecycle` 只读摘要；
2. `lifecycle.status` 能区分 undecided / approved / rejected / applied / rolled-back；
3. 审批页默认只展示待决策，支持多选切换；
4. 卡片默认收起，展开状态刷新后在同一浏览器 session 内保持；
5. 已 apply 的提案能展示 application、asset event、snapshot、rollback 摘要；
6. typecheck、lint、build、runner-contracts、smoke 通过；
7. `haro-web.service` 重启后 `/api/health` 正常，页面和 API 可加载。

## Hot reload / 验证

开发期可用 Vite hot reload 验证前端交互；本次收口按生产服务验证：构建完成后重启 `haro-web.service`，再用 3456 端口做 health、页面加载和只读 API smoke。
