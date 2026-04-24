# FEAT-015 ~ FEAT-019 omx Review 计划

> 本文档描述 Haro Web Dashboard 系列 5 个 FEAT 的 omx review 流程。
> 生成时间：2026-04-23
> spec 状态：全部 approved（Open Questions 已清零）

## 1. 前置检查

执行 review 前确认：

```bash
# 1. spec 状态
for f in specs/phase-1/FEAT-0{15..19}*.md; do
  echo "=== $f ==="
  grep "^status:" "$f"
done

# 2. Open Questions 清零（忽略删除线已解决项）
for f in specs/phase-1/FEAT-0{15..19}*.md; do
  echo "=== $f ==="
  grep "Q[0-9]\+:" "$f" | grep -v "~~" | wc -l
done

# 3. AC 可测性检查（顶级 - AC 条目）
for f in specs/phase-1/FEAT-0{15..19}*.md; do
  echo "=== $f ==="
  grep "^- AC" "$f" | wc -l
done
```

## 2. Review 策略

### 2.1 依赖顺序（必须串行）

Dashboard FEAT 有严格的依赖链，必须按顺序 review 和实现：

```
FEAT-015 (Foundation)
    ↓
FEAT-016 (Agent Interaction)
    ↓
FEAT-017 (System Management)
    ↓
FEAT-018 (Orchestration & Observability)
    ↓
FEAT-019 (Channel & Agent Management)
```

**原因**：后续 FEAT 的前端包、后端骨架、WebSocket 协议、基础组件都依赖前一个 FEAT 的产出。

### 2.2 Review 维度

每个 FEAT 必须通过以下 5 维 review：

| 维度 | 检查内容 | 工具/方法 |
|------|----------|-----------|
| **Spec 一致性** | 代码实现与 spec R/AC 对齐 | 人工核对 + grep `\[spec: FEAT-XXX#` |
| **设计原则合规** | P1-P8 有无违反 | 对照 `specs/design-principles.md` |
| **多 Agent 约束** | 约束①-⑤ 有无违反 | 对照 `specs/multi-agent-design-constraints.md` |
| **测试覆盖** | AC 对应的测试是否全绿 | `pnpm test` / `pnpm smoke` |
| **空上下文 Review** | 独立 agent 审视代码质量 | omx ralph review 模式 |

### 2.3 空上下文 Review 流程

对每个 FEAT，实现完成后执行：

```bash
# Step 1: 启动独立 review agent（不带实现阶段上下文偏见）
omx --fresh-context --high '$ralplan --review "FEAT-NNN review: 检查 AC 覆盖度、边界条件、错误处理、与 spec 一致性、代码风格、测试完整性"'

# Step 2: 根据 review 结果修复
# - blocker: 必须修复
# - warning: 原则上修复
# - nit: 可记录待办

# Step 3: 修复后重新验证
pnpm lint && pnpm test && pnpm build && pnpm smoke
```

## 3. 各 FEAT Review Checklist

### FEAT-015 — Foundation

**核心关注点**：
- [ ] `packages/web/` 是否正确接入 pnpm workspace
- [ ] `pnpm -F @haro/web build` 是否成功产出 dist/
- [ ] `haro web` CLI 命令是否正确注册
- [ ] Hono 后端是否正确 serve 静态文件
- [ ] 未配置 `HARO_WEB_API_KEY` 时是否打印 WARN 日志
- [ ] Dashboard 对核心模块是否零侵入

**风险点**：
- Vite 8 + Tailwind 4 + shadcn/ui 的组合可能存在版本兼容问题
- `pnpm dev:web` 同时启动 Vite + Hono 的脚本需要验证端口不冲突

---

### FEAT-016 — Agent Interaction

**核心关注点**：
- [ ] WebSocket `/ws` 端点协议是否与 spec 5.1 完全一致
- [ ] `system.status` 消息类型是否正确实现
- [ ] Agent 事件流是否禁止前端轮询（R3）
- [ ] WebSocket 断线重连是否指数退避
- [ ] `POST /api/v1/agents/:id/chat` 与 `run` 的语义区分是否清晰
- [ ] ChatPage localStorage 是否持久化最近配置
- [ ] SessionDetailPage text delta 是否正确折叠

**风险点**：
- Agent 执行事件（text delta / tool_call / tool_result）的时序正确性
- 多客户端同时观察同一 session 的并发处理

---

### FEAT-017 — System Management

**核心关注点**：
- [ ] StatusPage 健康卡片是否与 `haro doctor` 输出一致
- [ ] doctor 报告问题项是否高亮标红
- [ ] SettingsPage 配置来源层级是否正确展示
- [ ] `PUT /api/v1/config` 是否仅写入项目级配置
- [ ] 配置保存前是否通过 Zod schema 校验
- [ ] 高级配置折叠是否符合 P5 Progressive Disclosure

**风险点**：
- 配置写入的并发安全（多个 Dashboard 实例同时修改）
- YAML 原始文本编辑模式（CodeMirror 6）与表单模式的数据同步

---

### FEAT-018 — Orchestration & Observability

**核心关注点**：
- [ ] DispatchPage workflow 图是否严格遵守 fork-and-merge 拓扑（多 Agent 约束②）
- [ ] React Flow 节点布局是否 branch 平行、merge 同水平线
- [ ] KnowledgePage Memory 搜索 scope 限制是否正确（禁止写入 platform/）
- [ ] SkillsPage enable/disable 是否即时生效
- [ ] MonitorPage WebSocket 断线恢复后是否自动重订阅
- [ ] InvokeAgentPage provider 统计是否正确计算

**风险点**：
- React Flow 自定义 layout 算法可能复杂度高
- Memory 写入权限绕过（需校验 scope + user 身份）

---

### FEAT-019 — Channel & Agent Management

**核心关注点**：
- [ ] Agent CRUD API 是否与 FEAT-016 R5 兼容（扩展而非冲突）
- [ ] Agent YAML 编辑器是否使用 CodeMirror 6（非 Monaco）
- [ ] 保存前是否自动触发 Zod 校验
- [ ] 是否禁止删除正在使用的 defaultAgent
- [ ] Gateway 日志轮询是否每 3 秒一次
- [ ] ChannelPage 状态切换是否即时反映在 UI

**风险点**：
- Agent YAML 校验失败时的 UX（错误定位和提示）
- Gateway start/stop 的并发控制（防止重复启动）

## 4. Review 后提交规范

### Commit 格式

```
feat(scope): short subject  [spec: FEAT-NNN#R1]
```

### PR 要求

- 标题必须含 spec ID：`[FEAT-015] Web Dashboard — Foundation`
- 正文第一节贴 spec 相对路径链接
- 只将本次 FEAT 相关文件加入 staging
- 无关遗留变更不得混入

### Done 门槛

1. `pnpm lint` / `pnpm test` / `pnpm build` / `pnpm smoke` 全绿
2. `docs/` 同步更新
3. PR 合入 main
4. spec status 切 `done`，Changelog 补 `done` 一行
5. 删除本地临时 ralph 脚本 `scripts/omx-feat-NNN-*.sh`

## 5. 批量 Review 脚本

```bash
#!/bin/bash
# scripts/run-all-reviews.sh
# 一键执行所有 FEAT 的 review 验证

set -e

FEATS=("015" "016" "017" "018" "019")

for feat in "${FEATS[@]}"; do
  echo "========================================"
  echo "  Review FEAT-$feat"
  echo "========================================"

  # 1. 规范检查
  echo "--- spec compliance ---"
  grep -c "^status: done" "specs/phase-1/FEAT-$feat"*.md && echo "  status: done" || echo "  status: NOT done"

  # 2. 构建检查
  echo "--- build ---"
  pnpm build || { echo "  FAILED"; exit 1; }

  # 3. 测试检查
  echo "--- test ---"
  pnpm test || { echo "  FAILED"; exit 1; }

  # 4. 冒烟检查
  echo "--- smoke ---"
  pnpm smoke || { echo "  FAILED"; exit 1; }

  echo "  PASSED"
done

echo ""
echo "All FEAT reviews passed!"
```
