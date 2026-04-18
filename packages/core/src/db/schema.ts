export interface TableDefinition {
  readonly name: string;
  readonly ddl: string;
  readonly supportingDdl?: readonly string[];
}

export const HARO_TABLES: readonly TableDefinition[] = [
  {
    name: 'sessions',
    ddl: `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
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
