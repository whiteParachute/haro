/**
 * Structured tool errors (FEAT-032 R9).
 *
 * Tools throw `McpToolError` instead of returning failure manually so the
 * registry can map every code to its remediation/retryable flag in one place
 * (and audit it consistently).
 */

import type { ToolErrorCode, ToolErrorPayload } from './types.js';

const RETRYABLE: Record<ToolErrorCode, boolean> = {
  PERMISSION_DENIED: false,
  NEEDS_APPROVAL: false,
  INVALID_PARAMS: false,
  TARGET_NOT_FOUND: false,
  TARGET_DISABLED: false,
  TOOL_TIMEOUT: true,
  INTERNAL_ERROR: true,
};

const DEFAULT_REMEDIATION: Record<ToolErrorCode, string> = {
  PERMISSION_DENIED: 'Operator must grant the relevant permission for this tool / scope.',
  NEEDS_APPROVAL: 'Sensitive action queued — wait for operator approval, then retry.',
  INVALID_PARAMS: 'Fix params to match the tool inputSchema (see tools/list).',
  TARGET_NOT_FOUND: 'Target channelId / scope / job does not exist.',
  TARGET_DISABLED: 'Enable the target channel before invoking this tool.',
  TOOL_TIMEOUT: 'Reduce payload, then retry; tool exceeded its registered timeoutMs.',
  INTERNAL_ERROR: 'Inspect server logs for details and retry.',
};

export class McpToolError extends Error {
  readonly code: ToolErrorCode;
  readonly retryable: boolean;
  readonly remediation: string;

  constructor(code: ToolErrorCode, message: string, remediation?: string) {
    super(message);
    this.name = 'McpToolError';
    this.code = code;
    this.retryable = RETRYABLE[code];
    this.remediation = remediation ?? DEFAULT_REMEDIATION[code];
  }

  toPayload(): ToolErrorPayload {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      remediation: this.remediation,
    };
  }
}

export function isMcpToolError(err: unknown): err is McpToolError {
  return err instanceof McpToolError;
}

export function toErrorPayload(err: unknown): ToolErrorPayload {
  if (isMcpToolError(err)) return err.toPayload();
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: 'INTERNAL_ERROR',
    message,
    retryable: RETRYABLE.INTERNAL_ERROR,
    remediation: DEFAULT_REMEDIATION.INTERNAL_ERROR,
  };
}
