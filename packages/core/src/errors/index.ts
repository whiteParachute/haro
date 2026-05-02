/**
 * Shared error catalog for CLI + web-api (FEAT-039 R14).
 *
 * Both surfaces wrap business-logic failures in `HaroError` so the same
 * `code` + `remediation` reach the user regardless of entry point.
 */

export type HaroErrorCode =
  // service-layer generic
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'UNSUPPORTED'
  | 'INTERNAL'
  // session
  | 'SESSION_NOT_FOUND'
  | 'SESSION_DELETE_FAILED'
  // agent
  | 'AGENT_NOT_FOUND'
  | 'AGENT_ALREADY_EXISTS'
  | 'AGENT_VALIDATION_FAILED'
  | 'AGENT_DEFAULT_PROTECTED'
  | 'AGENT_ID_INVALID'
  // memory
  | 'MEMORY_PLATFORM_FORBIDDEN'
  | 'MEMORY_AGENT_SCOPE_LIMIT'
  | 'MEMORY_QUERY_INVALID'
  // workflow
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_CHECKPOINT_NOT_FOUND'
  // budget
  | 'BUDGET_AGENT_NOT_FOUND'
  // user
  | 'USER_NOT_FOUND'
  | 'USER_USERNAME_EXISTS'
  | 'USER_OWNER_TRANSFER_REQUIRED'
  | 'USER_LAST_OWNER_REQUIRED'
  | 'USER_INVALID_USERNAME'
  | 'USER_INVALID_PASSWORD'
  | 'USER_INVALID_DISPLAY_NAME'
  | 'USER_INVALID_ROLE'
  | 'USER_INVALID_STATUS'
  | 'USER_BOOTSTRAP_CLOSED'
  | 'USER_INVALID_CREDENTIALS'
  // skill
  | 'SKILL_NOT_FOUND'
  | 'SKILL_PREINSTALLED'
  | 'SKILL_AUDIT_UNSUPPORTED'
  // config
  | 'CONFIG_INVALID'
  | 'CONFIG_KEY_NOT_FOUND'
  | 'CONFIG_SECRET_REJECTED'
  | 'CONFIG_SCOPE_INVALID'
  // diagnostics (provider / channel / gateway doctor failures, surfaced via
  // CliErrorEnvelope so --json consumers see ok:false on stderr rather than
  // a fake ok:true on stdout)
  | 'PROVIDER_DOCTOR_FAILED'
  | 'CHANNEL_DOCTOR_FAILED'
  | 'GATEWAY_DOCTOR_FAILED';

export interface HaroErrorOptions {
  remediation?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class HaroError extends Error {
  readonly code: HaroErrorCode;
  readonly remediation?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: HaroErrorCode, message: string, options: HaroErrorOptions = {}) {
    super(message);
    this.name = 'HaroError';
    this.code = code;
    if (options.remediation) this.remediation = options.remediation;
    if (options.details) this.details = options.details;
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

export function isHaroError(value: unknown): value is HaroError {
  return value instanceof HaroError;
}

/**
 * Convert a HaroError to the wire format used by --json output and HTTP error
 * responses. Both surfaces share this shape.
 */
export function haroErrorToWire(error: HaroError): {
  code: HaroErrorCode;
  message: string;
  remediation?: string;
  details?: Record<string, unknown>;
} {
  return {
    code: error.code,
    message: error.message,
    ...(error.remediation ? { remediation: error.remediation } : {}),
    ...(error.details ? { details: error.details } : {}),
  };
}
