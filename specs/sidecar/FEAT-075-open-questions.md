# FEAT-075 开放问题答卷

## 状态

- 状态：draft
- 日期：2026-05-21
- 关联 spec：FEAT-075
- 范围：需求决策答卷
- 本文不实现代码

## 背景

FEAT-075 设计两个能力。

1. 自愈残留重复提案。
2. 根据修改意见重写提案。

本答卷回答 5 个开放问题。
每个问题都给出推荐答案。
用户 review 后再决定实现方向。

真实样例来自当前 Haro 数据。

| 对象 | 说明 |
| --- | --- |
| `proposal_2f3bf421` | 旧 runner-profile 提案 |
| `approval_request_3e1346f0` | 旧提案的审批请求 |
| `approval_decision_de3fed7` | 用户要求修改的决策 |
| `approval_request_798b8b81` | 次日生成的等价重复提案 |
| `proposal_86357913` | 等价重复提案 |
| `FEAT-069` | 2026-05-21 02:59Z 后上线 |
| daily cron | 当前为 `0 2 * * *` |

## 名词说明

| 名词 | 说明 |
| --- | --- |
| self-heal | Haro 自己清理残留问题 |
| daily | 每天自动运行的 workflow |
| confirm | 允许写入结果的确认开关 |
| direction | 用户写下的修改意见 |
| metadata | 机器可读的补充字段 |
| pending | 等待用户处理的状态 |
| blocked event | Haro 拦截提案后的记录 |
| contentHash | 本次改动内容的指纹 |

用户对 `proposal_2f3bf421` 的核心反馈是：

- 没说清具体错误。
- 没说清具体改动。
- 更像通用策略。
- 不像一个可执行提案。

## OQ-1：FEAT-069 生效时间如何记录

### 问题再陈述

FEAT-069 会挡住新重复提案。
但它只能约束上线后的产物。

`approval_request_798b8b81` 是残留项。
它在 daily cron 中生成。
生成时间是 2026-05-21 02:02Z。
FEAT-069 commit 是 `3129d38`。
commit 时间是 2026-05-21 02:59Z。

Haro 需要知道一个边界时间。
边界前的重复项可被 self-heal 清理。
边界后的重复项要被视为新 bug。

### 可选方案

| 方案 | 实现概要 | 对行为的影响 | 兼容性 |
| --- | --- | --- | --- |
| A. 代码常量 | 在代码里写 `3129d38` 和时间 | 简单，但升级要改代码 | 与 FEAT-069 兼容，扩展差 |
| B. Haro 配置文件 | 写入 `~/.haro/current/system-capabilities.json` | self-heal 可直接读取 | 与 sidecar asset 模型一致 |
| C. Git commit 查询 | 运行时读取本地 git log | 自动，但依赖 repo 存在 | 对 CLI 环境不稳定 |
| D. blocked event 水位 | 首次运行时写水位 artifact | 可审计，但初始化复杂 | 与 FEAT-069 事件模型兼容 |

### 取舍维度

- 是否机器可读。
- 是否可审计。
- 是否依赖 git 仓库。
- 是否容易回滚。
- 是否会误清理新提案。

### 推荐答案

**强推荐 B：Haro 配置文件。**

建议新增一个 sidecar-local 配置。
它记录功能名、commit、启用时间。
self-heal 只读这个配置。

理由：

- 不依赖 git 仓库存在。
- 用户可在 Web 或 CLI 中查看。
- 后续 FEAT 也能复用。
- 比代码常量更容易迁移。
- 比首次水位更容易解释。

### 如果用户选别的方案

选 A 会更快。
但每次调整都要发版。

选 C 会少一个配置。
但生产环境可能没有完整 git 历史。

### 遗留 sub-OQ

- 配置文件应由谁写入。
- 配置文件是否需要版本号。
- 缺配置时应保守跳过清理。

## OQ-2：daily 是否允许自动 confirm self-heal

### 问题再陈述

self-heal 可以发现残留重复项。
问题是 daily 是否能直接 reject 它。

以当前例子看，
`approval_request_798b8b81` 与旧提案等价。
用户已对旧提案要求修改。
它理论上可以被自动退回。

但自动 reject 仍是写入行为。
它会改变审批页状态。
需要定义默认权限。

### 可选方案

| 方案 | 实现概要 | 对行为的影响 | 兼容性 |
| --- | --- | --- | --- |
| A. daily 永远 dry-run | 只汇报命中，不写 decision | 最安全，用户仍要点 reject | 与现有 daily 人审边界一致 |
| B. daily 可自动 reject 等价项 | 严格命中才写 self-heal decision | 页面更干净，有误清理风险 | 需要新安全门 |
| C. 分阶段开关 | 默认 dry-run，配置后自动 confirm | 先观察，再放开 | 与 FEAT-055 类似 |
| D. Web 手动确认 | daily 生成清理建议，Web 一键执行 | 用户可控，前端要改 | 依赖 FEAT-053 UI 扩展 |

### 取舍维度

- 用户是否被重复打扰。
- 误清理风险。
- 审计可追溯性。
- 实现复杂度。
- 是否破坏人审原则。

### 推荐答案

**强推荐 C：分阶段开关。**

当前实现状态：手动 `haro self-heal duplicates --confirm` 已支持，
但 daily 自动 confirm 仍未开启。
因此 OQ-2 的默认答案仍是：daily 只 dry-run，
除非后续显式配置 `selfHeal.duplicates.autoConfirm=true`。

首版 daily 只 dry-run。
配置打开后才自动 reject。
配置名建议为：
`selfHeal.duplicates.autoConfirm=true`。

理由：

- 首版能先验证命中质量。
- 用户不会突然失去待审项。
- 命中稳定后可减少页面污染。
- 与当前人审边界不冲突。
- 也方便 supervisor 分批放开。

### 如果用户选别的方案

选 A 最稳。
但重复项仍会污染页面。

选 B 体验最好。
但一旦误判，用户会不信任 Haro。

### 遗留 sub-OQ

- 自动 confirm 是否只允许低风险提案。
- 自动 confirm 是否需要每日上限。
- 自动 confirm 是否要在飞书汇报。

## OQ-3：Web 是否需要展示 self-heal 决策来源

### 问题再陈述

self-heal 会写 reject decision。
reviewer 是 `haro-self-heal`。

用户打开 Haro Web 时，
需要知道这不是人手点的 reject。
也需要知道它为什么被清理。

当前 Web 已有审批工作台。
但它不一定能解释 self-heal 来源。

### 可选方案

| 方案 | 实现概要 | 对行为的影响 | 兼容性 |
| --- | --- | --- | --- |
| A. 不改 Web | 只在 JSON 和 daily summary 中记录 | 实现最小，用户不直观 | 与 FEAT-053 无冲突 |
| B. 列表加来源标签 | 显示“由 Haro 自愈退回” | 用户一眼能看懂 | 轻量扩展 FEAT-053 |
| C. 增加事件详情抽屉 | 展示匹配旧 decision 和指纹 | 审计最完整 | 前端改动较大 |
| D. 只在飞书汇报 | self-heal 后发 summary | 不改 Web，但信息分散 | 依赖 FEAT-058 通知 |

### 取舍维度

- 用户能否理解自动决策。
- 页面复杂度。
- 审计信息是否完整。
- 是否要改前端。
- 是否影响现有审批流。

### 推荐答案

**轻推荐 B：列表加来源标签。**

首版在已决策列表显示来源。
文案为“由 Haro 自愈退回”。
展开后展示旧 decision id。

理由：

- 信息足够明确。
- 不需要重做审批页。
- 能解释页面为什么少了一条 pending。
- 与 FEAT-053 生命周期视图一致。
- 后续可升级为详情抽屉。

### 如果用户选别的方案

选 A 能更快上线。
但用户只能从飞书或 JSON 追原因。

选 C 审计最好。
但会拉大 FEAT-075 首版体量。

### 遗留 sub-OQ

- 标签展示在 pending 列表还是已决策列表。
- 是否给 self-heal 增加筛选项。
- 是否展示 semantic fingerprint 命中原因。

## OQ-4：FEAT-073 是否采用 LLM 解析 direction

### 问题再陈述

用户的 direction 是自由文本。
例如 `approval_decision_de3fed7` 里，
用户没有写字段名。
他表达的是产品判断。

Haro 需要把它变成结构化要求。
例如：
“不要元策略”。
“要具体错误样本”。
“要 before / after”。

问题是解析靠规则，还是靠 LLM。
LLM 指大模型。
它能理解自然语言，
但会引入不确定性。

### 可选方案

| 方案 | 实现概要 | 对行为的影响 | 兼容性 |
| --- | --- | --- | --- |
| A. 只用规则 | 关键词和模板匹配 | 稳定，可测，覆盖有限 | 与 FEAT-072 最兼容 |
| B. LLM 只做建议 | LLM 输出 intent，规则复核 | 语义更强，仍可控 | 适合作为 FEAT-073 |
| C. LLM 直接重写 proposal | 模型生成完整新提案 | 效果最好，风险最高 | 需要强验证门 |
| D. Web 结构化输入 | 用户勾选修改类型 | 最准确，但增加用户负担 | 需要 Web 新交互 |

### 取舍维度

- 能否理解真实反馈。
- 输出是否可测试。
- 是否会编造证据。
- 用户输入负担。
- 实现和运维成本。

### 推荐答案

**强推荐 B：LLM 只做建议。**

FEAT-073 应采用混合方案。
LLM 负责把 direction 解析为 intent。
规则负责校验和降级。

理由：

- 只靠规则很难理解产品反馈。
- LLM 直接重写风险过高。
- intent 可以被 validate 复核。
- 证据仍来自 observation。
- 失败时可回到 blocked 状态。

### 如果用户选别的方案

选 A 更稳。
但会漏掉很多非模板化反馈。

选 C 更像理想态。
但必须先做强证据校验。

### 遗留 sub-OQ

- LLM 解析失败是否重试。
- LLM 输出是否要保存为 artifact。
- 用户是否能看到解析后的 intent。
- 是否允许用户编辑 intent。

## OQ-5：self-heal decision 是否需要独立 metadata 字段

### 问题再陈述

self-heal 会写 approval decision。
它需要说明：
为什么退回。
匹配了哪条旧 decision。
命中的是内容指纹还是语义指纹。

可以把这些都写进 direction 文本。
也可以新增结构化 metadata 字段。

当前用户关心可读原因。
后续系统会关心可机器分析。

### 可选方案

| 方案 | 实现概要 | 对行为的影响 | 兼容性 |
| --- | --- | --- | --- |
| A. 只写 direction | 所有原因写成人话文本 | 最快，机器难统计 | 不改 schema |
| B. 新增 metadata | 写 `selfHeal` 结构化字段 | 可查询，可测试 | 需扩展 contract |
| C. 只写 blocked event | decision 文本简短，详情在 event | 审计集中，关联要查两处 | 复用 FEAT-069 |
| D. direction + metadata | 人话和结构化都写 | 可读且可查 | 字段更多 |

### 取舍维度

- 用户是否看得懂。
- 机器是否能统计。
- schema 变更成本。
- 回滚是否清晰。
- 与 Web 展示是否兼容。

### 推荐答案

**强推荐 D：direction + metadata。**

direction 写人话解释。
metadata 写机器可读事实。
字段名建议为 `selfHeal`。

理由：

- 用户能直接读懂原因。
- CLI 和 Web 可按字段统计。
- 未来回滚能找到匹配依据。
- blocked event 可保留完整审计。
- 兼容旧 decision，不破坏读取。

### 如果用户选别的方案

选 A 上线更快。
但后续很难做统计和筛选。

选 C 可复用事件。
但用户在 decision 上看不到全量原因。

### 遗留 sub-OQ

- `selfHeal` 字段是否进入 contract schema。
- 旧 artifact 缺 metadata 时如何回填。
- Web 是否直接读取 metadata。

## 一句话推荐汇总

| OQ | 推荐答案 | 强度 |
| --- | --- | --- |
| OQ-1 | 用 Haro 配置文件记录 FEAT-069 生效时间 | 强推荐 |
| OQ-2 | daily 默认 dry-run，配置开启后自动 confirm | 强推荐 |
| OQ-3 | Web 显示“由 Haro 自愈退回”来源标签 | 轻推荐 |
| OQ-4 | FEAT-073 用 LLM 解析 intent，规则复核 | 强推荐 |
| OQ-5 | decision 同时写 direction 和 selfHeal metadata | 强推荐 |
