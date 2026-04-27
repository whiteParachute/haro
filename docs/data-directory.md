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

Phase 1 新增的 Memory / Asset / Budget 表由对应 FEAT 落地，原则如下：

```sql
-- FEAT-021: Memory Fabric v1 read model
CREATE TABLE memory_entries (
  id TEXT PRIMARY KEY,
  layer TEXT NOT NULL,
  scope TEXT NOT NULL,
  agent_id TEXT,
  topic TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  content_path TEXT,
  content_hash TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  asset_ref TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  confidence REAL,
  tags TEXT NOT NULL DEFAULT '[]',
  verification_evidence_refs TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  archived_reason TEXT
);

CREATE VIRTUAL TABLE memory_entries_fts USING fts5(
  entry_id UNINDEXED,
  topic,
  summary,
  content,
  tokenize='unicode61'
);

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
```

这些表是 SQLite read model / audit model；Markdown skill、prompt、memory 文件仍保留为人工可读 source 或兼容层。

FEAT-023 的审计边界：

- `operation_audit_log` 只记录被拒绝、需要审批、预算 near-limit、预算 exceeded 等护栏事件；普通低风险 `haro run` 不额外要求审批。
- `workflow_budgets` 使用固定 token hard limit；`estimated_cost` 只用于展示，不参与阻断。
- `token_budget_ledger` 按 workflow / branch / agent 记录 provider/model 与 input/output token，Team workflow 汇总所有 branch，不只看 merge session。
- `session_events.latency_ms` 保存 Runner 观测到的 provider attempt terminal 延迟；Web Provider stats 的 `avgLatencyMs` 基于该落库字段聚合，而不是前端占位或静态 mock。

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
