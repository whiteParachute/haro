# 数据目录设计

## 双层数据目录

Haro 采用双层数据目录设计：全局目录（`~/.haro/`）和项目级目录（`.haro/`）。

| 层级 | 路径 | 用途 |
|------|------|------|
| 全局 | `~/.haro/` | 全局配置、Agent 定义、记忆、数据库、Channel 状态 |
| 项目级 | `.haro/` | 项目特定配置、选择规则覆盖、项目级 Skills |

**优先级**：命令行参数 > 项目级 `.haro/` > 全局 `~/.haro/` > 内置默认值

## 全局目录结构

```
~/.haro/
├── config.yaml
├── selection-rules.yaml
├── agents/
├── skills/
│   ├── preinstalled/
│   ├── user/
│   ├── installed.json
│   ├── preinstalled-manifest.json
│   └── usage.sqlite
├── channels/
│   ├── feishu/
│   │   ├── state.json
│   │   └── sessions.sqlite
│   └── telegram/
│       ├── state.json
│       └── sessions.sqlite
├── memory/
├── assets/
│   ├── skills/              # 可选导出/人工检查副本，canonical 仍是原 skill 文件
│   ├── prompts/             # prompt asset 导出；Phase 1 最小边界为完整 systemPrompt
│   ├── routing-rules/       # 用户/项目级规则覆盖导出，不承载内建 RoutingMatrix 修改
│   ├── archives/            # shit archive 资产导出索引
│   └── manifest-exports/
├── evolution-context/
├── archive/
│   ├── eat-proposals/
│   └── shit-<timestamp>/
├── logs/
└── haro.db
```

## 项目级目录结构

```
.haro/
├── config.yaml
├── selection-rules.yaml
└── skills/
```

## 全局配置文件

```yaml
providers:
  codex:
    # 凭证通过 OPENAI_API_KEY 环境变量传递
    defaultModel: <live-codex-model-id>

memory:
  path: ~/.haro/memory

channels:
  cli:
    enabled: true
  feishu:
    enabled: false
    appId: "${FEISHU_APP_ID}"
    appSecret: "${FEISHU_APP_SECRET}"
    transport: websocket
    sessionScope: per-chat
  telegram:
    enabled: false
    botToken: "${TELEGRAM_BOT_TOKEN}"
    transport: long-polling

runtime:
  taskTimeoutMs: 600000

logging:
  level: info
  stdout: true
  file: ~/.haro/logs/haro.log

defaultAgent: haro-assistant
```

## SQLite 数据库结构

数据库文件：`~/.haro/haro.db`

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  context_ref TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL
);

CREATE TABLE session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  latency_ms INTEGER
);

CREATE TABLE workflow_checkpoints (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE provider_fallback_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  original_provider TEXT NOT NULL,
  original_model TEXT NOT NULL,
  fallback_provider TEXT NOT NULL,
  fallback_model TEXT NOT NULL,
  trigger TEXT NOT NULL,
  rule_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE component_usage (
  component_type TEXT NOT NULL,
  component_id TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (component_type, component_id)
);
```

Phase 1 新增的 Asset / Budget 表由对应 FEAT 落地。

> **FEAT-035 v2（2026-05-06）**：Memory Fabric 已删除 SQLite read model（`memory_entries` / `memory_entries_fts`），改为 aria-memory 风格的纯文件存储。记忆数据全部位于 `~/.haro/memory/<scope>/`（详见 [`docs/modules/memory-fabric.md`](modules/memory-fabric.md)）；老的 SQLite 行通过 `MemoryFabric.migrateFromV1({ dbFile })` 迁出，并在原路径写 `dbFile.bak.<timestamp>` 作为 30 天兜底。

```sql
-- FEAT-022: Evolution Asset Registry
CREATE TABLE evolution_assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('skill', 'prompt', 'routing-rule', 'memory', 'mcp', 'archive')),
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'archived', 'rejected', 'superseded')),
  source_ref TEXT NOT NULL,
  content_ref TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'agent', 'eat', 'shit', 'migration')),
  gep_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE evolution_asset_events (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES evolution_assets(id),
  type TEXT NOT NULL CHECK (type IN ('proposed', 'promoted', 'used', 'modified', 'enabled', 'disabled', 'archived', 'rollback', 'rejected', 'superseded', 'conflict')),
  actor TEXT NOT NULL CHECK (actor IN ('user', 'agent', 'system')),
  evidence_refs_json TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

-- FEAT-023: Permission & Token Budget Guard
CREATE TABLE operation_audit_log (
  id TEXT PRIMARY KEY,
  workflow_id TEXT,
  branch_id TEXT,
  agent_id TEXT,
  event_type TEXT NOT NULL,
  operation_class TEXT,
  policy TEXT,
  outcome TEXT NOT NULL,
  target_scope TEXT,   -- write-local: workspace / haro-state / outside-workspace / unknown
  target_ref TEXT,
  reason TEXT,
  approval_ref TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE workflow_budgets (
  budget_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL UNIQUE,
  limit_tokens INTEGER NOT NULL,       -- Phase 1 fixed hard token limit
  soft_limit_ratio REAL NOT NULL,
  estimated_branches INTEGER NOT NULL DEFAULT 0,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  used_input_tokens INTEGER NOT NULL DEFAULT 0,
  used_output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL,                 -- display/read-model only; not a blocking input
  state TEXT NOT NULL DEFAULT 'ok',
  blocked_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE token_budget_ledger (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES workflow_budgets(budget_id),
  workflow_id TEXT NOT NULL,
  branch_id TEXT,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL,
  created_at TEXT NOT NULL
);

-- FEAT-033: Cron scheduler (cron + once)
-- 复用主 DB（不引独立 cron.sqlite），任务持久化 + 跨进程 lease 协调。
CREATE TABLE cron_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  mode TEXT NOT NULL CHECK(mode IN ('cron','once')),
  when_expr TEXT NOT NULL,        -- cron expression OR ISO-8601 timestamp
  task_input TEXT NOT NULL,       -- prompt fed to AgentRunner
  retry_policy TEXT,              -- JSON {max, backoff: 'exponential'|'linear'|'fixed'}
  status TEXT NOT NULL,           -- pending / running / done / failed / cancelled / cancelled-forced / missed
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER,
  last_status TEXT,               -- ok / error
  last_error TEXT,
  last_delivery_error TEXT,
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER,
  metadata TEXT
);
CREATE INDEX idx_cron_jobs_session ON cron_jobs(session_id);
CREATE INDEX idx_cron_jobs_due ON cron_jobs(enabled, next_run_at);

-- 单行哨兵：跨进程 advisory lock，让多个 tick caller（web-api ticker /
-- haro cron daemon / haro cron tick）不会重复 dispatch 同一 due job。
-- 持锁期间 tick 后台按 TTL/2 续约；renewal 失败则停止后续派发。
CREATE TABLE cron_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  holder TEXT NOT NULL,           -- "<host>:<pid>"
  acquired_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL
);
```

这些表是 SQLite read model / audit model；Markdown skill、prompt、memory 文件仍保留为人工可读 source 或兼容层。

FEAT-023 的审计边界：

- `operation_audit_log` 只记录被拒绝、需要审批、预算 near-limit、预算 exceeded 等护栏事件；普通低风险 `haro run` 不额外要求审批。
- `workflow_budgets` 使用固定 token hard limit；`estimated_cost` 只用于展示，不参与阻断。
- `token_budget_ledger` 按 workflow / branch / agent 记录 provider/model 与 input/output token，Team workflow 汇总所有 branch，不只看 merge session。
- `session_events.latency_ms` 保存 Runner 观测到的 provider attempt terminal 延迟；Web Provider stats 的 `avgLatencyMs` 基于该落库字段聚合，而不是前端占位或静态 mock。

FEAT-033 的 cron 边界：

- `cron_jobs` 单 session 默认配额 50（`enabled=1 AND next_run_at IS NOT NULL` 计入）；超限走 FEAT-023 Permission Guard 升配。Cron 频率下限 1 分钟（拒绝 6 字段秒级表达式）；once 严格 ISO-8601（必须 Z 或 ±HH:MM offset）。
- `cron_lease` 单行哨兵；TTL 默认 60s；任意 tick caller（web-api ticker / `haro cron daemon` / `haro cron tick`）任一在跑即可调度，**不强依赖 web-api**。
- `status='running'` 期间 cancel 走「立即 flip 'cancelled' + abort signal + 30s graceful 等待 → 超时则 force-flip 'cancelled-forced'」；runner 所有 setStatus / advanceNextRun 用 `requireNotCancelled` SQL guard 防写覆盖。
- 已知限制：跨进程 cancel 不能 force-abort 另一进程的 in-flight；DB 层 cancel 让对端下次 tick 跳过即可（spec §3 / §8 Q2）。

## Agent 状态文件

每个 Agent 在 `~/.haro/agents/{id}/state.json` 维护跨 session 状态：

```json
{
  "agentId": "code-reviewer",
  "lastUpdated": "2026-04-19T08:00:00Z",
  "taskContext": {
    "description": "当前任务描述",
    "goals": [],
    "constraints": []
  },
  "executionHistory": [
    {
      "sessionId": "sess_xxx",
      "timestamp": "2026-04-19T08:00:00Z",
      "taskPreview": "帮我审查 src/provider.ts",
      "outcome": "completed"
    }
  ],
  "keyDecisions": [],
  "pendingWork": []
}
```
