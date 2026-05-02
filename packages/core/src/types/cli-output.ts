/**
 * Shared --json output envelope for CLI commands (FEAT-039 R11/AC12).
 *
 * The CLI uses these envelopes to ensure --json output is consumable by
 * jq/grep pipelines, and to keep the wire format stable across web-api +
 * CLI. Each list command emits one record per line in NDJSON mode.
 */

import type { HaroErrorCode } from '../errors/index.js';

export type CliOutputMode = 'json' | 'human';

export interface CliRecordEnvelope<T> {
  ok: true;
  data: T;
}

export interface CliListEnvelope<T> {
  ok: true;
  data: {
    items: readonly T[];
    total: number;
    limit?: number;
    offset?: number;
  };
}

export interface CliErrorEnvelope {
  ok: false;
  error: {
    code: HaroErrorCode | 'UNKNOWN';
    message: string;
    remediation?: string;
    details?: Record<string, unknown>;
  };
}

export type CliEnvelope<T> = CliRecordEnvelope<T> | CliErrorEnvelope;
export type CliListResult<T> = CliListEnvelope<T> | CliErrorEnvelope;
