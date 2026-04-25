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
│   ├── skills/
│   ├── prompts/
│   ├── routing-rules/
│   ├── archives/
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
  created_at TEXT NOT NULL
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
CREATE TABLE evolution_assets (...);
CREATE TABLE evolution_asset_events (...);

-- FEAT-023: Permission & Token Budget Guard
CREATE TABLE operation_audit_log (...);
CREATE TABLE token_budget_ledger (...);
```

这些表是 SQLite read model / audit model；Markdown skill、prompt、memory 文件仍保留为人工可读 source 或兼容层。

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
