/**
 * Read-only MCP services surface (FEAT-032 step #14).
 *
 * Exposes recent tool_invocation_log rows so CLI / web-api can surface what
 * the agent has been doing without forcing every caller to import @haro/mcp-tools
 * directly. Write paths stay in `@haro/mcp-tools` — this layer only reads.
 */

import { initHaroDatabase } from '../db/init.js';
import type { ServiceContext } from './types.js';

export interface ToolInvocationRecord {
  id: string;
  sessionId: string;
  agentId: string;
  toolName: string;
  paramsHash: string;
  decision: 'allowed' | 'denied' | 'needs-approval';
  resultStatus: 'success' | 'error' | 'pending';
  latencyMs: number | null;
  errorCode: string | null;
  invokedAt: number;
}

export interface ListInvocationsOptions {
  sessionId?: string;
  toolName?: string;
  limit?: number;
}

export function listInvocations(
  ctx: ServiceContext,
  options: ListInvocationsOptions = {},
): ToolInvocationRecord[] {
  const opened = initHaroDatabase({
    ...(ctx.root ? { root: ctx.root } : {}),
    ...(ctx.dbFile ? { dbFile: ctx.dbFile } : {}),
    keepOpen: true,
  });
  const db = opened.database!;
  try {
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.sessionId) {
      where.push('session_id = ?');
      params.push(options.sessionId);
    }
    if (options.toolName) {
      where.push('tool_name = ?');
      params.push(options.toolName);
    }
    let sql = 'SELECT * FROM tool_invocation_log';
    if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY invoked_at DESC, rowid DESC LIMIT ?';
    params.push(Math.max(options.limit ?? 100, 1));
    const rows = db.prepare(sql).all(...params) as Array<{
      id: string;
      session_id: string;
      agent_id: string;
      tool_name: string;
      params_hash: string;
      decision: ToolInvocationRecord['decision'];
      result_status: ToolInvocationRecord['resultStatus'];
      latency_ms: number | null;
      error_code: string | null;
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
  } finally {
    db.close();
  }
}
