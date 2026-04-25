import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { buildHaroPaths } from '../paths.js';
import { HARO_TABLES } from './schema.js';

export interface InitDbOptions {
  dbFile?: string;
  root?: string;
  /** When true, leave the database open and return it. Default: false (closes the handle). */
  keepOpen?: boolean;
}

export interface InitDbResult {
  dbFile: string;
  tables: string[];
  journalMode: string;
  fts5Available: boolean;
  database?: Database.Database;
}

const FTS5_PROBE_SQL = `CREATE VIRTUAL TABLE IF NOT EXISTS _haro_fts5_probe USING fts5(payload)`;
const FTS5_PROBE_DROP = `DROP TABLE IF EXISTS _haro_fts5_probe`;

function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function probeFts5(db: Database.Database): boolean {
  try {
    db.exec(FTS5_PROBE_SQL);
    db.exec(FTS5_PROBE_DROP);
    return true;
  } catch {
    return false;
  }
}

function hasColumn(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const rows = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === column);
}

function runMigrations(db: Database.Database): void {
  if (!hasColumn(db, 'sessions', 'context_ref')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN context_ref TEXT`);
  }
}

/**
 * Initialize the Haro SQLite database. Idempotent: may be called repeatedly
 * without side effects beyond opening + verifying the schema.
 */
export function initHaroDatabase(opts: InitDbOptions = {}): InitDbResult {
  const paths = buildHaroPaths(opts.root);
  const dbFile = opts.dbFile ?? paths.dbFile;
  ensureParentDir(dbFile);

  const db = new Database(dbFile);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const journalMode = String(db.pragma('journal_mode', { simple: true }));

    const fts5Available = probeFts5(db);
    if (!fts5Available) {
      throw new Error(
        'SQLite FTS5 extension is required (used by FEAT-021 Memory Fabric v1 search) but is not available in this better-sqlite3 build.',
      );
    }

    db.exec('BEGIN');
    try {
      for (const table of HARO_TABLES) {
        db.exec(table.ddl);
        if (table.supportingDdl) {
          for (const ddl of table.supportingDdl) db.exec(ddl);
        }
      }
      runMigrations(db);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const tables = HARO_TABLES.map((t) => t.name);
    const result: InitDbResult = { dbFile, tables, journalMode, fts5Available };
    if (opts.keepOpen) {
      result.database = db;
      return result;
    }
    db.close();
    return result;
  } catch (err) {
    try {
      db.close();
    } catch {
      /* ignore close failure while propagating original error */
    }
    throw err;
  }
}
