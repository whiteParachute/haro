# 数据目录设计

## 双层数据目录

Haro 采用双层数据目录设计：全局目录（`~/.haro/`）和项目级目录（`.haro/`）。

| 层级 | 路径 | 用途 |
|------|------|------|
| 全局 | `~/.haro/` | 全局配置、所有 Agent 定义、记忆、数据库 |
| 项目级 | `.haro/`（项目根目录下） | 项目特定配置、选择规则覆盖、项目级 Skills |

**优先级**：命令行参数 > 项目级 `.haro/` > 全局 `~/.haro/` > 内置默认值

## 全局目录结构

```
~/.haro/
├── config.yaml               # 全局配置
├── selection-rules.yaml      # 全局 Provider/Model 选择规则
├── agents/                   # Agent 定义文件（YAML）
│   ├── haro-assistant.yaml
│   ├── code-reviewer.yaml
│   └── ...
├── skills/                   # Skills（详见 docs/modules/skills-system.md）
│   ├── preinstalled/         # 预装 15 个（受 shit 白名单保护）
│   ├── user/                 # 用户手动安装
│   ├── installed.json        # 已装 skill 清单
│   └── usage.sqlite          # 使用统计（供 shit 使用）
├── channels/                 # Channel 运行态（详见 docs/modules/channel-layer.md）
│   ├── feishu/
│   │   ├── state.json
│   │   └── sessions.sqlite
│   └── telegram/
│       ├── state.json
│       └── sessions.sqlite
├── memory/                   # 记忆存储
│   ├── platform/             # 平台级记忆
│   │   ├── index.md
│   │   └── knowledge/
│   ├── agents/               # Per-Agent 私有记忆
│   │   ├── haro-assistant/
│   │   │   ├── index.md
│   │   │   └── knowledge/
│   │   └── code-reviewer/
│   │       ├── index.md
│   │       └── knowledge/
│   └── shared/               # 团队共享记忆（Phase 1）
│       ├── index.md
│       └── knowledge/
├── evolution-context/        # Evolution Engine 共享目录（全局级，原始数据不压缩）
│   ├── observe/
│   ├── orient/
│   ├── decide/
│   └── act/
├── archive/                  # shit 归档 + 其他可回滚数据
│   └── shit-<timestamp>/
├── logs/                     # 日志文件
│   ├── haro.log              # 主日志
│   ├── channel-<id>.log      # 每个 Channel 独立日志
│   └── evolution.log         # 进化日志（Phase 2）
└── haro.db                   # SQLite 数据库（WAL 模式）
```

## 项目级目录结构

```
.haro/                        # 项目级（可选）
├── config.yaml               # 项目级配置（覆盖全局）
├── selection-rules.yaml      # 项目级选择规则（覆盖全局）
└── skills/                   # 项目级 Skills（覆盖全局同名 Skill）
```

## 全局配置文件

```yaml
# ~/.haro/config.yaml

# Provider 配置
providers:
  claude:
    # 无需 apiKey，订阅自动认证（参考 lark-bridge）
    # 不得配置 apiKey，否则绕过 Agent SDK 有封号风险
    defaultModel: claude-sonnet-4-5
  codex:
    apiKey: "${OPENAI_API_KEY}"
    defaultModel: codex-1

# 记忆配置
memory:
  # 默认：单路径（独立记忆能力）
  path: ~/.haro/memory          # 也可指向已有的 aria-memory 目录
  # 主备为可选（仅为兼容 aria-memory 主备模式）：
  # primary:
  #   path: ~/.haro/memory
  #   globalSleep: true
  # backup:
  #   path: /mnt/nas/haro-memory-backup
  #   globalSleep: false

# Channel 配置（详见 docs/modules/channel-layer.md）
channels:
  cli:
    enabled: true
  feishu:
    enabled: false
    appId: "${FEISHU_APP_ID}"
    appSecret: "${FEISHU_APP_SECRET}"
    mode: long-polling
    sessionScope: per-chat
  telegram:
    enabled: false
    botToken: "${TELEGRAM_BOT_TOKEN}"
    mode: long-polling

# Evolution 代谢（详见 specs/evolution-metabolism.md）
evolution:
  metabolism:
    shitInterval: 30d           # shit 周期扫描间隔
    shitAutoTrigger: false      # Phase 0 仅手动；Phase 2 可开启自动
    eatAutoTrigger: false

# 日志配置
logging:
  level: info                   # debug | info | warn | error
  stdout: true
  file: ~/.haro/logs/haro.log

# 默认 Agent
defaultAgent: haro-assistant
```

## SQLite 数据库结构

数据库文件：`~/.haro/haro.db`（WAL 模式）

```sql
-- 会话表
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL  -- 'running' | 'completed' | 'failed'
);

-- 事件表
CREATE TABLE session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- 'text' | 'tool_call' | 'tool_result' | 'result' | 'error'
  event_data TEXT NOT NULL,  -- JSON
  created_at TEXT NOT NULL
);

-- 工作流 Checkpoint 表
CREATE TABLE workflow_checkpoints (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  state TEXT NOT NULL,  -- JSON 序列化的完整状态
  created_at TEXT NOT NULL
);

-- Provider Fallback 日志表
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

-- 组件使用统计（供 shit 代谢使用）
CREATE TABLE component_usage (
  component_type TEXT NOT NULL,  -- 'rule' | 'skill' | 'mcp' | 'memory'
  component_id TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (component_type, component_id)
);
```

## Agent 状态文件

每个 Agent 在 `~/.haro/agents/{id}/state.json` 维护跨 session 状态：

```json
{
  "agentId": "code-reviewer",
  "lastUpdated": "2026-04-18T08:00:00Z",
  "taskContext": {
    "description": "当前任务描述",
    "goals": [],
    "constraints": []
  },
  "executionHistory": [],
  "keyDecisions": [],
  "pendingWork": []
}
```

详见：[docs/modules/agent-runtime.md](modules/agent-runtime.md)
