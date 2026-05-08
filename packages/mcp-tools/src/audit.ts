/**
 * tool_invocation_log writer (FEAT-032 R8 / AC7).
 *
 * Each call records: caller session, tool, params HASH (never raw payload),
 * permission decision, result status, latency, error code. Schema lives in
 * @haro/core db/schema.ts so existing initHaroDatabase() bootstraps the table
 * alongside FEAT-031 / FEAT-033 tables.
 */

import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { initHaroDatabase } from '@haro/core/db';

import type {
  ToolDecision,
  ToolErrorCode,
  ToolInvocationAudit,
  ToolResultStatus,
} from './types.js';

export interface AuditWriterOptions {
  root?: string;
  dbFile?: string;
  /**
   * Optional JSONL sidecar audit sink. FEAT-044 `haro mcp` uses this for the
   * AgentDock-facing read-only MCP server while the historical FEAT-032 path
   * keeps its SQLite audit rows unchanged.
   */
  jsonlFile?: string;
  /** Pre-opened DB handle (tests). When provided, root/dbFile are ignored. */
  db?: Database.Database;
  now?: () => Date;
  createId?: () => string;
}

export interface AuditAppendInput {
  sessionId: string;
  agentId: string;
  toolName: string;
  params: unknown;
  decision: ToolDecision;
  resultStatus: ToolResultStatus;
  latencyMs: number | null;
  errorCode: ToolErrorCode | null;
}

export class ToolInvocationAuditWriter {
  private readonly db: Database.Database;
  private readonly ownsDb: boolean;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly jsonlFile?: string;

  constructor(options: AuditWriterOptions = {}) {
    if (options.db) {
      this.db = options.db;
      this.ownsDb = false;
    } else {
      const opened = initHaroDatabase({
        ...(options.root ? { root: options.root } : {}),
        ...(options.dbFile ? { dbFile: options.dbFile } : {}),
        keepOpen: true,
      });
      this.db = opened.database!;
      this.ownsDb = true;
    }
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => `tool_inv_${randomUUID()}`);
    this.jsonlFile = options.jsonlFile;
  }

  close(): void {
    if (this.ownsDb) this.db.close();
  }

  append(input: AuditAppendInput): ToolInvocationAudit {
    const row: ToolInvocationAudit = {
      id: this.createId(),
      sessionId: input.sessionId,
      agentId: input.agentId,
      toolName: input.toolName,
      paramsHash: hashParams(input.params),
      decision: input.decision,
      resultStatus: input.resultStatus,
      latencyMs: input.latencyMs,
      errorCode: input.errorCode,
      invokedAt: this.now().getTime(),
    };
    this.db
      .prepare(
        `INSERT INTO tool_invocation_log (
           id, session_id, agent_id, tool_name, params_hash,
           decision, result_status, latency_ms, error_code, invoked_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.id,
        row.sessionId,
        row.agentId,
        row.toolName,
        row.paramsHash,
        row.decision,
        row.resultStatus,
        row.latencyMs,
        row.errorCode,
        row.invokedAt,
      );
    if (this.jsonlFile) {
      mkdirSync(dirname(this.jsonlFile), { recursive: true });
      appendFileSync(
        this.jsonlFile,
        `${JSON.stringify({
          id: row.id,
          sessionId: row.sessionId,
          agentId: row.agentId,
          toolName: row.toolName,
          paramsHash: row.paramsHash,
          decision: row.decision,
          resultStatus: row.resultStatus,
          latencyMs: row.latencyMs,
          errorCode: row.errorCode,
          invokedAt: row.invokedAt,
        })}\n`,
        'utf8',
      );
    }
    return row;
  }

  list(filter: { sessionId?: string; toolName?: string; limit?: number } = {}): ToolInvocationAudit[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.sessionId) {
      where.push('session_id = ?');
      params.push(filter.sessionId);
    }
    if (filter.toolName) {
      where.push('tool_name = ?');
      params.push(filter.toolName);
    }
    let sql = 'SELECT * FROM tool_invocation_log';
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY invoked_at DESC, rowid DESC LIMIT ?';
    params.push(Math.max(filter.limit ?? 100, 1));
    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      session_id: string;
      agent_id: string;
      tool_name: string;
      params_hash: string;
      decision: ToolDecision;
      result_status: ToolResultStatus;
      latency_ms: number | null;
      error_code: ToolErrorCode | null;
      invoked_at: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      agentId: row.agent_id,
      toolName: row.tool_name,
      paramsHash: row.params_hash,
      decision: row.decision,
      resultStatus: row.result_status,
      latencyMs: row.latency_ms,
      errorCode: row.error_code,
      invokedAt: row.invoked_at,
    }));
  }
}

/**
 * Hash params for audit. The output is stable (deterministic stringify) so
 * operators can correlate identical-payload calls. We salt with the
 * `HARO_TOOL_AUDIT_SALT` env when present so leaked rows can't be reversed
 * via a public dictionary attack on small param spaces (e.g. fixed channel
 * ids). Full SHA-256 hex is returned to keep dictionary attacks expensive.
 */
export function hashParams(params: unknown): string {
  const text = stableStringify(params);
  const salt = process.env.HARO_TOOL_AUDIT_SALT ?? '';
  return createHash('sha256').update(salt).update('|').update(text).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
