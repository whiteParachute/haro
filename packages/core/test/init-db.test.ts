/** AC4 — SQLite init is idempotent; WAL + FTS5 enabled; 5 tables present. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { initHaroDatabase } from '../src/db/init.js';
import { HARO_TABLES } from '../src/db/schema.js';

const EXPECTED_TABLE_NAMES = [
  'sessions',
  'session_events',
  'workflow_checkpoints',
  'provider_fallback_log',
  'component_usage',
];

function listUserTables(dbFile: string): string[] {
  const db = new Database(dbFile, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  } finally {
    db.close();
  }
}

describe('initHaroDatabase [FEAT-001]', () => {
  let root: string;
  let dbFile: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'haro-db-'));
    dbFile = join(root, 'haro.db');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC4 creates all five tables with WAL journaling', () => {
    const result = initHaroDatabase({ dbFile });
    expect(result.journalMode.toLowerCase()).toBe('wal');
    expect(result.tables).toEqual(EXPECTED_TABLE_NAMES);
    const tables = listUserTables(dbFile);
    for (const name of EXPECTED_TABLE_NAMES) {
      expect(tables).toContain(name);
    }
  });

  it('R5 FTS5 extension is available (probe table succeeds)', () => {
    const result = initHaroDatabase({ dbFile });
    expect(result.fts5Available).toBe(true);
  });

  it('AC4 second invocation is idempotent: no error and schema unchanged', () => {
    initHaroDatabase({ dbFile });
    const before = listUserTables(dbFile);
    expect(() => initHaroDatabase({ dbFile })).not.toThrow();
    const after = listUserTables(dbFile);
    expect(after).toEqual(before);
  });

  it('AC4 idempotent write survives data preservation across re-init', () => {
    const first = initHaroDatabase({ dbFile, keepOpen: true });
    try {
      first.database!
        .prepare(
          `INSERT INTO sessions (id, agent_id, provider, model, started_at, status) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('sess_test', 'agent_test', 'claude', 'claude-sonnet-4-5', '2026-04-18T00:00:00Z', 'running');
    } finally {
      first.database!.close();
    }
    initHaroDatabase({ dbFile });
    const db = new Database(dbFile, { readonly: true });
    try {
      const row = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get('sess_test') as
        | { id: string }
        | undefined;
      expect(row?.id).toBe('sess_test');
    } finally {
      db.close();
    }
  });

  it('HARO_TABLES definitions cover exactly the expected set', () => {
    expect(HARO_TABLES.map((t) => t.name).sort()).toEqual([...EXPECTED_TABLE_NAMES].sort());
  });
});
