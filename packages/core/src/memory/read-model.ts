import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { MEMORY_READ_MODEL_TABLES } from '../db/schema.js';
import { tokenize } from './index-store.js';
import type {
  MemoryEntry,
  MemoryEntryScope,
  MemoryLayer,
  MemoryQuery,
  MemorySearchResult,
  MemoryStats,
  VerificationStatus,
} from './types.js';

interface MemoryEntryRow {
  rowid: number;
  id: string;
  layer: MemoryLayer;
  scope: MemoryEntryScope;
  agent_id: string | null;
  topic: string;
  summary: string;
  content: string;
  content_path: string | null;
  content_hash: string;
  source_ref: string;
  asset_ref: string | null;
  verification_status: VerificationStatus;
  confidence: number | null;
  tags: string;
  verification_evidence_refs: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_reason: string | null;
  bm25?: number | null;
}

const STATUS_ORDER: Record<VerificationStatus, number> = {
  verified: 0,
  unverified: 1,
  conflicted: 2,
  rejected: 9,
};

const LAYER_ORDER: Record<MemoryLayer, number> = {
  persistent: 0,
  skill: 1,
  session: 2,
};

export class MemoryReadModel {
  private readonly db: Database.Database;

  constructor(dbFile: string) {
    mkdirSync(dirname(dbFile), { recursive: true });
    this.db = new Database(dbFile);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.ensureSchema();
  }

  close(): void {
    this.db.close();
  }

  findById(id: string): MemoryEntry | null {
    const row = this.db
      .prepare(`SELECT rowid, * FROM memory_entries WHERE id = ?`)
      .get(id) as MemoryEntryRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  findByContentHash(layer: MemoryLayer, scope: MemoryEntryScope, contentHash: string): MemoryEntry | null {
    const row = this.db
      .prepare(
        `SELECT rowid, * FROM memory_entries
          WHERE layer = ? AND scope = ? AND content_hash = ?
          LIMIT 1`,
      )
      .get(layer, scope, contentHash) as MemoryEntryRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  findTopicConflicts(input: {
    layer: MemoryLayer;
    scope: MemoryEntryScope;
    topic: string;
    contentHash: string;
  }): MemoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT rowid, * FROM memory_entries
          WHERE layer = ?
            AND scope = ?
            AND topic = ?
            AND content_hash <> ?
            AND archived_at IS NULL
            AND verification_status <> 'rejected'`,
      )
      .all(input.layer, input.scope, input.topic, input.contentHash) as MemoryEntryRow[];
    return rows.map(rowToEntry);
  }

  insert(entry: MemoryEntry): MemoryEntry {
    this.db
      .prepare(
        `INSERT INTO memory_entries (
           id,
           layer,
           scope,
           agent_id,
           topic,
           summary,
           content,
           content_path,
           content_hash,
           source_ref,
           asset_ref,
           verification_status,
           confidence,
           tags,
           verification_evidence_refs,
           created_at,
           updated_at,
           archived_at,
           archived_reason
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.layer,
        entry.scope,
        entry.agentId ?? null,
        entry.topic,
        entry.summary,
        entry.content,
        entry.contentPath ?? null,
        entry.contentHash,
        entry.sourceRef,
        entry.assetRef ?? null,
        entry.verificationStatus,
        entry.confidence ?? null,
        JSON.stringify(entry.tags),
        JSON.stringify(entry.verificationEvidenceRefs),
        entry.createdAt,
        entry.updatedAt,
        entry.archivedAt ?? null,
        entry.archivedReason ?? null,
      );
    this.refreshFts(entry.id);
    return entry;
  }

  attachAssetRef(id: string, assetRef: string, updatedAt: string): void {
    const result = this.db
      .prepare(
        `UPDATE memory_entries
            SET asset_ref = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(assetRef, updatedAt, id);
    if (result.changes === 0) throw new Error(`MemoryFabric.writeEntry: unknown entry id '${id}'`);
    this.refreshFts(id);
  }

  markConflicted(ids: readonly string[], evidenceRefs: readonly string[], updatedAt: string): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    this.db
      .prepare(
        `UPDATE memory_entries
            SET verification_status = 'conflicted',
                verification_evidence_refs = ?,
                updated_at = ?
          WHERE id IN (${placeholders})
            AND verification_status <> 'rejected'`,
      )
      .run(JSON.stringify(evidenceRefs), updatedAt, ...ids);
  }

  markVerification(id: string, status: VerificationStatus, evidenceRefs: readonly string[], updatedAt: string): void {
    const result = this.db
      .prepare(
        `UPDATE memory_entries
            SET verification_status = ?,
                verification_evidence_refs = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(status, JSON.stringify(evidenceRefs), updatedAt, id);
    if (result.changes === 0) throw new Error(`MemoryFabric.markVerification: unknown entry id '${id}'`);
  }

  archive(id: string, reason: string, archivedAt: string): void {
    const result = this.db
      .prepare(
        `UPDATE memory_entries
            SET archived_at = ?,
                archived_reason = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(archivedAt, reason, archivedAt, id);
    if (result.changes === 0) throw new Error(`MemoryFabric.archiveEntry: unknown entry id '${id}'`);
  }

  query(query: MemoryQuery): MemorySearchResult[] {
    const keyword = (query.keyword ?? query.query ?? '').trim();
    const ftsQuery = buildFtsQuery(keyword);
    const params: unknown[] = [];
    const where: string[] = [];
    let sql: string;
    if (ftsQuery) {
      sql = [
        'WITH fts AS (',
        '  SELECT rowid, bm25(memory_entries_fts) AS bm25',
        '    FROM memory_entries_fts',
        '   WHERE memory_entries_fts MATCH ?',
        ')',
        'SELECT e.rowid, e.*, fts.bm25',
        '  FROM fts',
        '  JOIN memory_entries e ON e.rowid = fts.rowid',
      ].join('\n');
      params.push(ftsQuery);
    } else {
      sql = `SELECT e.rowid, e.*, NULL AS bm25 FROM memory_entries e`;
    }

    if (!query.includeArchived) where.push('e.archived_at IS NULL');
    const statuses = normalizeArray(query.verificationStatus);
    if (statuses.length > 0) {
      where.push(`e.verification_status IN (${placeholders(statuses)})`);
      params.push(...statuses);
    } else {
      where.push(`e.verification_status <> 'rejected'`);
    }

    const scopes = uniqueValues([...(query.scope ? [query.scope] : []), ...(query.scopes ?? [])]);
    if (scopes.length > 0) {
      where.push(`e.scope IN (${placeholders(scopes)})`);
      params.push(...scopes);
    }

    const layers = normalizeArray(query.layer);
    if (layers.length > 0) {
      where.push(`e.layer IN (${placeholders(layers)})`);
      params.push(...layers);
    }

    if (query.agentId && scopes.length === 0) {
      where.push('(e.agent_id = ? OR e.scope = ?)');
      params.push(query.agentId, `agent:${query.agentId}`);
    }

    if (query.assetRef) {
      where.push('e.asset_ref = ?');
      params.push(query.assetRef);
    }

    if (query.skillId) {
      where.push('(e.asset_ref = ? OR e.asset_ref = ? OR e.tags LIKE ? OR e.source_ref LIKE ?)');
      params.push(query.skillId, `skill:${query.skillId}`, jsonLike(query.skillId), `%${query.skillId}%`);
    }

    for (const tag of query.tags ?? []) {
      where.push('e.tags LIKE ?');
      params.push(jsonLike(tag));
    }

    if (query.since) {
      where.push('e.created_at >= ?');
      params.push(query.since);
    }

    if (where.length > 0) {
      sql = `${sql}\n WHERE ${where.join('\n   AND ')}`;
    }
    sql = `${sql}\n ORDER BY ${ftsQuery ? 'fts.bm25 ASC,' : ''} e.updated_at DESC\n LIMIT ?`;
    params.push(Math.max(query.limit ?? 20, 1) * 6);

    const rows = this.db.prepare(sql).all(...params) as MemoryEntryRow[];
    const ranked = rows
      .map((row) => ({
        row,
        score: scoreRow(row, query, ftsQuery !== null),
      }))
      .sort((a, b) => b.score - a.score || b.row.updated_at.localeCompare(a.row.updated_at))
      .slice(0, query.limit ?? 20);
    return ranked.map((item, index) => ({
      entry: rowToEntry(item.row),
      score: item.score,
      rank: index + 1,
      matchedBy: matchedBy(query, ftsQuery !== null),
    }));
  }

  stats(): Pick<MemoryStats, 'totalEntries' | 'archivedEntries' | 'byLayer' | 'byScope' | 'byVerificationStatus'> {
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM memory_entries`)
      .get() as { total: number };
    const archivedRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM memory_entries WHERE archived_at IS NOT NULL`)
      .get() as { total: number };
    return {
      totalEntries: countRow.total,
      archivedEntries: archivedRow.total,
      byLayer: countBy<MemoryLayer>(this.db, 'layer', ['session', 'persistent', 'skill']),
      byScope: countByString(this.db, 'scope'),
      byVerificationStatus: countBy<VerificationStatus>(this.db, 'verification_status', [
        'unverified',
        'verified',
        'conflicted',
        'rejected',
      ]),
    };
  }

  private ensureSchema(): void {
    this.db.exec('BEGIN');
    try {
      for (const table of MEMORY_READ_MODEL_TABLES) {
        this.db.exec(table.ddl);
        if (table.supportingDdl) {
          for (const ddl of table.supportingDdl) this.db.exec(ddl);
        }
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private refreshFts(id: string): void {
    const row = this.db
      .prepare(`SELECT rowid, * FROM memory_entries WHERE id = ?`)
      .get(id) as MemoryEntryRow | undefined;
    if (!row) return;
    this.db
      .prepare(
        `UPDATE memory_entries_fts
            SET entry_id = ?,
                topic = ?,
                summary = ?,
                content = ?
          WHERE rowid = ?`,
      )
      .run(row.id, row.topic, row.summary, ftsText(row), row.rowid);
  }
}

function rowToEntry(row: MemoryEntryRow): MemoryEntry {
  const entry: MemoryEntry = {
    id: row.id,
    layer: row.layer,
    scope: row.scope,
    topic: row.topic,
    summary: row.summary,
    content: row.content,
    contentHash: row.content_hash,
    sourceRef: row.source_ref,
    verificationStatus: row.verification_status,
    tags: parseStringArray(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    verificationEvidenceRefs: parseStringArray(row.verification_evidence_refs),
  };
  if (row.agent_id) entry.agentId = row.agent_id;
  if (row.content_path) entry.contentPath = row.content_path;
  if (row.asset_ref) entry.assetRef = row.asset_ref;
  if (row.confidence !== null) entry.confidence = row.confidence;
  if (row.archived_at) entry.archivedAt = row.archived_at;
  if (row.archived_reason) entry.archivedReason = row.archived_reason;
  return entry;
}

function ftsText(row: MemoryEntryRow): string {
  const tags = parseStringArray(row.tags).join(' ');
  const source = row.source_ref;
  const asset = row.asset_ref ?? '';
  const tokenText = tokenize(`${row.topic}\n${row.summary}\n${row.content}\n${tags}\n${source}\n${asset}`).join(' ');
  return `${row.content}\n${tags}\n${source}\n${asset}\n${tokenText}`;
}

function buildFtsQuery(keyword: string): string | null {
  const tokens = tokenize(keyword);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ');
}

function scoreRow(row: MemoryEntryRow, query: MemoryQuery, hasFts: boolean): number {
  const bm25 = typeof row.bm25 === 'number' ? row.bm25 : 0;
  const ftsScore = hasFts ? 50 - Math.max(-10, Math.min(10, bm25)) : 0;
  const statusScore = 30 - STATUS_ORDER[row.verification_status] * 8;
  const scopeScore = scopeScoreFor(row.scope, query.agentId);
  const layerScore = 10 - LAYER_ORDER[row.layer] * 2;
  const confidenceScore = Math.round((row.confidence ?? 0) * 5);
  return ftsScore + statusScore + scopeScore + layerScore + confidenceScore;
}

function scopeScoreFor(scope: MemoryEntryScope, agentId: string | undefined): number {
  if (agentId && scope === `agent:${agentId}`) return 20;
  if (scope === 'shared') return 16;
  if (scope.startsWith('project:')) return 12;
  if (scope === 'platform') return 8;
  return 0;
}

function matchedBy(query: MemoryQuery, hasFts: boolean): string[] {
  const out: string[] = [];
  if (hasFts) out.push('fts5');
  if (query.scope || query.scopes) out.push('scope');
  if (query.layer) out.push('layer');
  if (query.verificationStatus) out.push('verificationStatus');
  if (query.agentId) out.push('agentId');
  if (query.assetRef) out.push('assetRef');
  if (query.skillId) out.push('skillId');
  if (query.tags && query.tags.length > 0) out.push('tags');
  return out;
}

function normalizeArray<T>(value: T | readonly T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? Array.from(value) : [value as T];
}

function uniqueValues<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function jsonLike(value: string): string {
  return `%${JSON.stringify(value).slice(1, -1)}%`;
}

function parseStringArray(raw: string): readonly string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    /* tolerate legacy rows */
  }
  return [];
}

function countBy<T extends string>(db: Database.Database, column: string, keys: readonly T[]): Record<T, number> {
  const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
  const rows = db
    .prepare(`SELECT ${column} AS key, COUNT(*) AS total FROM memory_entries GROUP BY ${column}`)
    .all() as Array<{ key: T; total: number }>;
  for (const row of rows) {
    if (row.key in result) result[row.key] = row.total;
  }
  return result;
}

function countByString(db: Database.Database, column: string): Record<string, number> {
  const rows = db
    .prepare(`SELECT ${column} AS key, COUNT(*) AS total FROM memory_entries GROUP BY ${column}`)
    .all() as Array<{ key: string; total: number }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.total]));
}
