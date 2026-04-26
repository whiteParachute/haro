export interface TableDefinition {
  readonly name: string;
  readonly ddl: string;
  readonly supportingDdl?: readonly string[];
}

export const CORE_TABLES: readonly TableDefinition[] = [
  {
    name: 'sessions',
    ddl: `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      context_ref TEXT,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed'))
    )`,
    supportingDdl: [
      `CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`,
    ],
  },
  {
    name: 'session_events',
    ddl: `CREATE TABLE IF NOT EXISTS session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    supportingDdl: [
      `CREATE INDEX IF NOT EXISTS idx_session_events_session_id ON session_events(session_id)`,
    ],
  },
  {
    name: 'workflow_checkpoints',
    ddl: `CREATE TABLE IF NOT EXISTS workflow_checkpoints (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    supportingDdl: [
      `CREATE INDEX IF NOT EXISTS idx_workflow_checkpoints_workflow_id ON workflow_checkpoints(workflow_id)`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_checkpoints_workflow_created
         ON workflow_checkpoints(workflow_id, created_at)`,
    ],
  },
  {
    name: 'operation_audit_log',
    ddl: `CREATE TABLE IF NOT EXISTS operation_audit_log (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      branch_id TEXT,
      agent_id TEXT,
      event_type TEXT NOT NULL,
      operation_class TEXT,
      policy TEXT,
      outcome TEXT NOT NULL,
      target_scope TEXT,
      target_ref TEXT,
      reason TEXT,
      approval_ref TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    )`,
    supportingDdl: [
      `CREATE INDEX IF NOT EXISTS idx_operation_audit_log_workflow_id
         ON operation_audit_log(workflow_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_operation_audit_log_event_type
         ON operation_audit_log(event_type, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_operation_audit_log_outcome
         ON operation_audit_log(outcome, created_at)`,
    ],
  },
  {
    name: 'workflow_budgets',
    ddl: `CREATE TABLE IF NOT EXISTS workflow_budgets (
      budget_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL UNIQUE,
      limit_tokens INTEGER NOT NULL,
      soft_limit_ratio REAL NOT NULL,
      estimated_branches INTEGER NOT NULL DEFAULT 0,
      estimated_tokens INTEGER NOT NULL DEFAULT 0,
      used_input_tokens INTEGER NOT NULL DEFAULT 0,
      used_output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL,
      state TEXT NOT NULL DEFAULT 'ok'
        CHECK (state IN ('ok', 'near-limit', 'exceeded')),
      blocked_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    supportingDdl: [
      `CREATE INDEX IF NOT EXISTS idx_workflow_budgets_workflow_id
         ON workflow_budgets(workflow_id)`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_budgets_state
         ON workflow_budgets(state, updated_at)`,
    ],
  },
  {
    name: 'token_budget_ledger',
    ddl: `CREATE TABLE IF NOT EXISTS token_budget_ledger (
      id TEXT PRIMARY KEY,
      budget_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      branch_id TEXT,
      agent_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(budget_id) REFERENCES workflow_budgets(budget_id)
    )`,
    supportingDdl: [
      `CREATE INDEX IF NOT EXISTS idx_token_budget_ledger_workflow_id
         ON token_budget_ledger(workflow_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_token_budget_ledger_branch_id
         ON token_budget_ledger(branch_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_token_budget_ledger_agent_id
         ON token_budget_ledger(agent_id, created_at)`,
    ],
  },
  {
    name: 'provider_fallback_log',
    ddl: `CREATE TABLE IF NOT EXISTS provider_fallback_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      original_provider TEXT NOT NULL,
      original_model TEXT NOT NULL,
      fallback_provider TEXT NOT NULL,
      fallback_model TEXT NOT NULL,
      trigger TEXT NOT NULL,
      rule_id TEXT,
      created_at TEXT NOT NULL
    )`,
  },
  {
    name: 'component_usage',
    ddl: `CREATE TABLE IF NOT EXISTS component_usage (
      component_type TEXT NOT NULL CHECK (component_type IN ('rule', 'skill', 'mcp', 'memory')),
      component_id TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (component_type, component_id)
    )`,
  },
];

export const MEMORY_READ_MODEL_TABLES: readonly TableDefinition[] = [
  {
    name: 'memory_entries',
    ddl: `CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      layer TEXT NOT NULL CHECK (layer IN ('session', 'persistent', 'skill')),
      scope TEXT NOT NULL,
      agent_id TEXT,
      topic TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      content_path TEXT,
      content_hash TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      asset_ref TEXT,
      verification_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'verified', 'conflicted', 'rejected')),
      confidence REAL,
      tags TEXT NOT NULL DEFAULT '[]',
      verification_evidence_refs TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      archived_reason TEXT
    )`,
    supportingDdl: [
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_entries_hash_scope_layer
         ON memory_entries(layer, scope, content_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_entries_scope_layer_status
         ON memory_entries(scope, layer, verification_status, archived_at)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_entries_agent_id
         ON memory_entries(agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_entries_asset_ref
         ON memory_entries(asset_ref)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_entries_topic
         ON memory_entries(scope, layer, topic)`,
    ],
  },
  {
    name: 'memory_entries_fts',
    ddl: `CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
      entry_id UNINDEXED,
      topic,
      summary,
      content,
      tokenize = 'unicode61'
    )`,
    supportingDdl: [
      `CREATE TRIGGER IF NOT EXISTS memory_entries_ai
         AFTER INSERT ON memory_entries
       BEGIN
         INSERT INTO memory_entries_fts(rowid, entry_id, topic, summary, content)
         VALUES (new.rowid, new.id, new.topic, new.summary, new.content);
       END`,
      `CREATE TRIGGER IF NOT EXISTS memory_entries_au
         AFTER UPDATE OF topic, summary, content ON memory_entries
       BEGIN
         UPDATE memory_entries_fts
            SET entry_id = new.id,
                topic = new.topic,
                summary = new.summary,
                content = new.content
          WHERE rowid = old.rowid;
       END`,
      `CREATE TRIGGER IF NOT EXISTS memory_entries_ad
         AFTER DELETE ON memory_entries
       BEGIN
         DELETE FROM memory_entries_fts WHERE rowid = old.rowid;
       END`,
    ],
  },
];

export const EVOLUTION_ASSET_TABLES: readonly TableDefinition[] = [
  {
    name: 'evolution_assets',
    ddl: `CREATE TABLE IF NOT EXISTS evolution_assets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL
        CHECK (kind IN ('skill', 'prompt', 'routing-rule', 'memory', 'mcp', 'archive')),
      name TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      status TEXT NOT NULL
        CHECK (status IN ('proposed', 'active', 'archived', 'rejected', 'superseded')),
      source_ref TEXT NOT NULL,
      content_ref TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_by TEXT NOT NULL
        CHECK (created_by IN ('user', 'agent', 'eat', 'shit', 'migration')),
      gep_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    supportingDdl: [
      `CREATE INDEX IF NOT EXISTS idx_evolution_assets_kind_status
         ON evolution_assets(kind, status, updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_evolution_assets_content_hash
         ON evolution_assets(content_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_evolution_assets_kind_name
         ON evolution_assets(kind, name)`,
      `CREATE INDEX IF NOT EXISTS idx_evolution_assets_source_ref
         ON evolution_assets(source_ref)`,
    ],
  },
  {
    name: 'evolution_asset_events',
    ddl: `CREATE TABLE IF NOT EXISTS evolution_asset_events (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      type TEXT NOT NULL
        CHECK (type IN (
          'proposed',
          'promoted',
          'used',
          'modified',
          'enabled',
          'disabled',
          'archived',
          'rollback',
          'rejected',
          'superseded',
          'conflict'
        )),
      actor TEXT NOT NULL CHECK (actor IN ('user', 'agent', 'system')),
      evidence_refs_json TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(asset_id) REFERENCES evolution_assets(id)
    )`,
    supportingDdl: [
      `CREATE INDEX IF NOT EXISTS idx_evolution_asset_events_asset_id
         ON evolution_asset_events(asset_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_evolution_asset_events_type
         ON evolution_asset_events(type, created_at)`,
    ],
  },
];

export const HARO_TABLES: readonly TableDefinition[] = [
  ...CORE_TABLES,
  ...MEMORY_READ_MODEL_TABLES,
  ...EVOLUTION_ASSET_TABLES,
];
