# Haro 全局 Review 报告 — Phase 0 验收与 Phase 1 开工前检查

> 评审范围：所有 `specs/phase-0/`、roadmap 验收标准、`docs/`、README、`packages/` 源代码
> 评审日期：2026-04-21
> 结论：**Phase 0 有 3 项 P1 卡点必须修复后方可进入 Phase 1；另有 4 项 P1/P2 文档虚假声明需同步修正。**

---

## 一、Phase 0 验收标准对照

| # | 验收项 | 状态 | 说明 |
|---|--------|------|------|
| 1 | `haro run "列出当前目录下的 TypeScript 文件"` 成功执行 | ⚠️ 依赖 live key | 代码路径完整，有集成测试；需 `OPENAI_API_KEY` 验证 |
| 2 | Codex Provider 可独立使用 | ✅ | `healthCheck()`、`listModels()`、`query()`、`contextContinuation` 均实现并通过测试 |
| 3 | Session 数据写入 SQLite | ✅ | `sessions` + `session_events` 表写入完整，测试覆盖 AC3 |
| 4 | 记忆文件在 session 结束后正确更新 | 🔴 **未达标** | `memory-wrapup hook` 在 CLI 中**未被配置到 AgentRunner**，session 成功后只打印 "skipped" debug log，不会自动触发记忆写入 |
| 5 | `haro doctor` 能正确诊断 Provider + Channel 状态 | ⚠️ 部分达标 | Provider / 目录 / SQLite 检查通过，但**已启用 Channel 的健康状态未检查** |
| 6 | 从飞书和 Telegram 分别发起任务并收到回复 | ⚠️ 依赖 live 环境 | adapter 实现完整，需真实凭证验证 |
| 7 | 15 个预装 skill 全部可用 | ✅ | `haro skills list` 列出 15 个，预装 manifest 完整 |
| 8 | `haro eat` 对一个 URL 完整走完四问验证 + 预览 + 写入 | 🔴 **未达标** | 质量门槛只实现 4/8 条，**四问验证逻辑缺失** |
| 9 | `haro shit --scope skills --dry-run` 正确列出候选且不误删预装 | ✅ | 白名单机制保护预装 skill，测试覆盖 |
| 10 | `haro shit rollback` 能恢复归档的组件 | ✅ | rollback 命令实现，测试覆盖 |
| 11 | 核心模块无 `providerId === 'xxx'` 或 `channelId === 'xxx'` 特判 | ✅ | ESLint `r7-lint.test.ts` 通过，grep 扫描无命中 |

**Phase 0 验收结论：11 项中 7 项达标，2 项依赖 live 环境，2 项（#4、#8）未达标。**

---

## 二、阻碍 Phase 1 开工的 P1 卡点

### 卡点 1：CLI 中 memory-wrapup hook 未配置，session 结束后记忆不写入

**违反 spec：**
- FEAT-005 R6："Session 成功结束后触发 `memory-wrapup` hook"
- FEAT-007 R3 T3："`MemoryFabric.wrapupSession()`，把完整 transcript 提炼为一个 impression；无论 T1/T2 是否写过都执行"

**代码事实：**
- `packages/cli/src/index.ts:836-843` 创建 `AgentRunner` 时**未传入** `memoryWrapupHook`
- `packages/core/src/runtime/runner.ts:608-611` 发现没有 hook 时仅打印 debug log 并返回
- 结果是：用户通过 CLI 运行任何任务，session 结束后都不会自动触发记忆 wrapup

**影响：**
- Phase 0 验收标准 #4（记忆文件在 session 结束后正确更新）**无法通过**
- Phase 1 的 Memory Fabric v1 依赖稳定的 wrapup 机制，基础不牢

**修复建议：**
- 在 CLI bootstrap 时，将 `SkillsManager` 的 memory-wrapup 能力桥接为 `AgentRunner` 的 `memoryWrapupHook`
- 或让 `AgentRunner` 在无外部 hook 时，直接调用内部的 `MemoryFabric.wrapupSession()`

---

### 卡点 2：FEAT-011 eat 质量门槛不完整，四问验证缺失

**违反 spec：**
- FEAT-011 R3："包含质量门槛（8 条拒绝条件）+ 四问验证"

**代码事实：**
- `packages/skills/src/metabolism.ts:206-216` 只实现了 4 条检查：
  1. `not-generic-knowledge`（硬编码关键词匹配 Python/语法/Hello World）
  2. `not-too-small`（长度 >= 20）
  3. `has-failure-backed-detail`（正则匹配 must/always/because/workflow/rule/principle）
  4. `has-triggerable-context`（正则匹配 workflow/rule/principle/skill/步骤/场景）
- **缺失 4 条**：纯娱乐/一次性使用/质量低、与现有规则冲突、已存在等价规则/skill、Agent 能从代码库推导的内容
- **四问验证**（Failure-backed? Tool-enforceable? Decision-encoding? Triggerable?）作为显式决策逻辑完全缺失

**影响：**
- Phase 0 验收标准 #8 无法完整通过
- eat 产出的知识质量无法保证，低质量内容可能污染 Memory Fabric

**修复建议：**
- 补齐剩余 4 条拒绝条件（至少以保守启发式实现）
- 在四问验证框架下显式输出每一步决策理由

---

### 卡点 3：FEAT-010 R8 违反 — skill 名字硬编码在核心代码路径

**违反 spec：**
- FEAT-010 R8："核心代码不得出现具体 skill 名字硬编码"
- FEAT-010 AC5：`grep -rE "skillId\s*===|skill\.id\s*===" packages/core packages/cli` 应返回 0 行

**代码事实：**
- `packages/cli/src/index.ts:565`：`app.skills.invokeCommandSkill('eat', ...)`
- `packages/cli/src/index.ts:588`：`app.skills.invokeCommandSkill('shit', ...)`
- `packages/skills/src/manager.ts:248`：方法签名 `skillId: 'eat' | 'shit'`
- `packages/skills/src/manager.ts:254`：`if (skillId === 'eat')`

**影响：**
- 破坏可插拔原则
- Phase 1 的 Skill Marketplace 要求动态注册和调用 skill，硬编码会阻碍扩展
- AC5 grep 测试在实际运行中会命中 `manager.ts:254`

**修复建议：**
- `invokeCommandSkill` 应接受任意 `string` skillId，通过 skill 元数据中的 `handler` 字段路由到对应实现
- CLI 的 `eat` / `shit` 命令应通过 skill 注册表动态查找并调用，不直接写死 `'eat'` / `'shit'`

---

## 三、文档虚假声明（P1/P2）

以下文档描述的功能**实际不存在**，会导致用户按文档操作直接失败。

| # | 文档 | 虚假声明 | 实际代码 | 严重度 |
|---|------|---------|---------|--------|
| 3.1 | `docs/cli-design.md:96-98` | `haro config set memory.path /path/...`<br>`haro config get providers.codex.defaultModel` | 只有 `haro config`（dump 合并后的 JSON），无 `set`/`get` 子命令 | **P1** |
| 3.2 | `docs/cli-design.md:87` | `haro model --select` | `--select` 标志未实现 | P2 |
| 3.3 | `docs/cli-design.md:214` | `/compress` 压缩当前上下文 | 仅检查 capability 并输出提示"Phase 0 尚未接入压缩执行路径"，无任何压缩逻辑 | P2 |
| 3.4 | `docs/cli-design.md:119` | `haro doctor` 检查已启用 Channel 健康状态 | `runDoctor()` 只检查 Provider、目录、SQLite，不检查任何 Channel | P2 |

---

## 四、版本号与格式不一致

| # | 位置 | 声明 | 实际 | 严重度 |
|---|------|------|------|--------|
| 4.1 | `README.md` | "当前仓库版本是 `0.0.0`" | CLI `VERSION = '0.1.0'`，`package.json` 也是 `0.1.0` | P3 |
| 4.2 | `docs/cli-design.md:39` | REPL banner 显示 `Haro v0.1.0` | `CliChannel.showBanner()` 硬编码 `Haro v0.0.0` | P2 |
| 4.3 | `docs/data-directory.md`<br>`docs/configuration.md` | `config.yaml` 是 YAML 格式 | `setup.ts:143` 用 `JSON.stringify` 写入 `.yaml` 文件 | P2 |
| 4.4 | `docs/channels.md:218`<br>`docs/channels.md:172` | Gateway 日志路径矛盾：表中说 `gateway.log`，但 `gateway status` 示例输出 `haro.log` | `gatewayStatus` 代码打印 `app.paths.logFile`（即 `haro.log`），但 daemon 实际写入 `gateway.log` | P2 |

---

## 五、Spec 与代码的其他不一致

| # | Spec | 问题 | 位置 | 严重度 |
|---|------|------|------|--------|
| 5.1 | FEAT-011 R11 | `specs/` 目录不在 shit 白名单中。虽然 specs/ 在仓库根目录（不在 `~/.haro/` 下），但如果用户复制 specs 到数据目录，会被扫描归档 | `metabolism.ts:243-295` | P2 |
| 5.2 | FEAT-011 R18 | archive 大小阈值警告未实现 | `metabolism.ts` | P2 |
| 5.3 | FEAT-011 R17 | eat 非完全原子：记忆写入发生在 proposal bundle 生成之前，bundle 失败时记忆已突变 | `metabolism.ts:50-90` | P2 |
| 5.4 | FEAT-012 R3 | `config.yaml` 写入 JSON 内容，虽可被 YAML parser 读取，但不符合 `.yaml` 扩展名预期 | `setup.ts:143` | P2 |
| 5.5 | FEAT-006 R7 | `haro doctor` 对 config 只输出 `ok: true`，不验证 schema（配置错误在 `bootstrapApp` 阶段捕获，doctor 本身不复检） | `index.ts:1409` | P2 |

---

## 六、Phase 1 开工前提检查

Phase 1 的核心交付（来自 `roadmap/phases.md`）：
- Scenario Router
- Team Orchestrator
- Memory Fabric v1
- Actor 消息驱动运行时
- MCP Tool Provider 适配器
- 新增 Channel（Slack / Web chat / Email）
- Skill Marketplace 雏形

**开工前提（specs/README.md 流程要求）：**
1. Phase 0 验收标准全部满足 ✅❌（2 项未达标：#4 memory-wrapup、#8 eat 四问验证）
2. Spec 与代码无漂移 ✅❌（3 项 P1 spec 违反）
3. docs 与 spec 同步 ✅❌（多处文档虚假声明）
4. Phase 1 首个 spec 已起草 ❌（`specs/phase-1/` 目录为空）

**结论：当前不满足 Phase 1 开工条件。**

---

## 七、修复优先级建议

### 必须先修（进入 Phase 1 的硬性门槛）

1. **配置 CLI memory-wrapup hook** — 让 `AgentRunner` 在 session 结束后自动触发记忆写入
2. **补齐 eat 质量门槛** — 实现剩余 4 条拒绝条件 + 四问验证框架
3. **消除 skill 名字硬编码** — 重构 `invokeCommandSkill` 为通用路由，CLI eat/shit 命令走动态 skill 调用

### 应同步修（避免用户踩坑）

4. **删除/修正 docs/cli-design.md 中的虚假命令声明** — `config set/get`、`model --select`、`/compress` 功能描述
5. **统一版本号** — README、CLI banner、`package.json` 对齐到同一版本
6. **修复 doctor 的 Channel 健康检查** — 至少检查已启用 external channel 的 `healthCheck()`
7. **setup 写入真正的 YAML** — 用 `yaml.stringify` 替代 `JSON.stringify`

### 可延后修（不阻塞 Phase 1）

8. shit 白名单补 `specs/`、archive 阈值警告、eat 原子性优化

---

## 八、验证清单（修复后需全绿）

```bash
# 1. 代码质量
pnpm lint
pnpm test
pnpm build
pnpm smoke

# 2. Phase 0 验收手动验证
haro run "列出当前目录下的 TypeScript 文件"   # 应成功返回
haro doctor                                   # 应包含 channel 健康状态
haro eat https://example.com/article          # 应走完 8 条质量门槛 + 四问验证
haro shit --scope skills --dry-run            # 应列出候选且不含预装 skill

# 3. 文档与代码一致性抽检
grep -rE "skillId\s*===|skill\.id\s*===" packages/core packages/cli packages/skills/src  # 应返回 0 行
grep -rE "providerId\s*===|provider\.id\s*===" packages/core  # 应返回 0 行

# 4. 记忆写入验证
# 运行一次 haro run 后，检查 ~/.haro/memory/impressions/ 下是否生成新文件
```

---

*本报告基于 2026-04-21 的 main 分支（commit `6ddf241`）生成。*
