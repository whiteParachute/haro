/** FEAT-039 batch 0 — service-layer parity contract for sessions. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initHaroDatabase } from '../src/db/init.js';
import {
  deleteSession,
  getSession,
  listSessionEvents,
  listSessions,
  tryGetSession,
} from '../src/services/sessions.js';
import { HaroError } from '../src/errors/index.js';

let root: string;
let dbFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'haro-services-sessions-'));
  dbFile = join(root, 'haro.db');
  initHaroDatabase({ dbFile });
  const db = new Database(dbFile);
  try {
    const insertSession = db.prepare(
      `INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    );
    insertSession.run('s1', 'haro-default', 'codex', 'gpt-5', '2026-05-01T00:00:00Z', 'completed');
    insertSession.run('s2', 'haro-default', 'codex', 'gpt-5', '2026-05-02T00:00:00Z', 'running');
    db.prepare(
      `INSERT INTO session_events (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)`,
    ).run('s1', 'result', JSON.stringify({ ok: true }), '2026-05-01T00:01:00Z');
  } finally {
    db.close();
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('services.sessions', () => {
  it('listSessions paginates with default page size 20', () => {
    const result = listSessions({ root, dbFile });
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.pageInfo).toMatchObject({ page: 1, pageSize: 20, hasPreviousPage: false });
  });

  it('listSessions accepts legacy limit/offset', () => {
    const result = listSessions({ root, dbFile }, { limit: '1', offset: '1' });
    expect(result.items).toHaveLength(1);
    expect(result.pageInfo).toMatchObject({ page: 2, pageSize: 1, hasPreviousPage: true });
  });

  it('getSession throws SESSION_NOT_FOUND for missing id', () => {
    expect(() => getSession({ root, dbFile }, 'missing')).toThrowError(HaroError);
    try {
      getSession({ root, dbFile }, 'missing');
    } catch (error) {
      expect(error).toBeInstanceOf(HaroError);
      expect((error as HaroError).code).toBe('SESSION_NOT_FOUND');
    }
  });

  it('tryGetSession returns null instead of throwing', () => {
    expect(tryGetSession({ root, dbFile }, 'missing')).toBeNull();
    expect(tryGetSession({ root, dbFile }, 's1')).not.toBeNull();
  });

  it('listSessionEvents returns events for known session', () => {
    const result = listSessionEvents({ root, dbFile }, 's1');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.eventType).toBe('result');
  });

  it('deleteSession removes row + audit; outcome=success', () => {
    const observed: Array<{ outcome: string }> = [];
    const result = deleteSession(
      { root, dbFile },
      's1',
      { audit: (e) => observed.push(e) },
    );
    expect(result.outcome).toBe('success');
    expect(observed).toEqual([{ outcome: 'success' }]);
    expect(tryGetSession({ root, dbFile }, 's1')).toBeNull();

    const db = new Database(dbFile, { readonly: true });
    try {
      const audit = db
        .prepare(`SELECT event_type FROM operation_audit_log WHERE target_ref = 's1'`)
        .all() as Array<{ event_type: string }>;
      expect(audit).toEqual([{ event_type: 'session.delete' }]);
    } finally {
      db.close();
    }
  });

  it('deleteSession reports not-found for missing id', () => {
    const result = deleteSession({ root, dbFile }, 'never-existed');
    expect(result.outcome).toBe('not-found');
  });

  it('deleteSession honors auditEventType override (web-api parity)', () => {
    deleteSession({ root, dbFile }, 's2', { auditEventType: 'web.session.delete' });
    const db = new Database(dbFile, { readonly: true });
    try {
      const audit = db
        .prepare(`SELECT event_type FROM operation_audit_log WHERE target_ref = 's2'`)
        .all() as Array<{ event_type: string }>;
      expect(audit).toEqual([{ event_type: 'web.session.delete' }]);
    } finally {
      db.close();
    }
  });
});
