import type { AgentErrorEvent } from '@haro/core/provider';

/**
 * FEAT-003 §5 "错误处理" — translate transport / Codex errors into the
 * canonical AgentErrorEvent shape that FEAT-005 Runner consumes.
 *
 * The mapping is deliberately stateless and string-shape based: the SDK
 * surfaces errors as `Error` instances with messages like
 * "401 Unauthorized" or "context length exceeded", and we do not want a
 * brittle dependency on internal SDK error classes that may change between
 * patch versions.
 *
 * AC7 hard requirement: every event with `code === 'context_too_long'`
 * MUST carry `hint: 'save-and-clear'` so FEAT-005 Runner can route to
 * MemoryFabric.wrapupSession + clear `previousResponseId`.
 */

export const SAVE_AND_CLEAR_HINT = 'save-and-clear' as const;

interface ErrorWithStatus {
  status?: number;
  statusCode?: number;
  code?: string;
  message?: string;
}

export function mapCodexError(err: unknown): AgentErrorEvent {
  const meta = extractMeta(err);
  const status = meta.status;
  const message = meta.message ?? 'Codex SDK error';
  const lower = message.toLowerCase();

  if (
    lower.includes('context length') ||
    lower.includes('context_length_exceeded') ||
    lower.includes('maximum context length') ||
    lower.includes('context window') ||
    lower.includes('context_too_long')
  ) {
    return {
      type: 'error',
      code: 'context_too_long',
      message,
      retryable: false,
      hint: SAVE_AND_CLEAR_HINT,
    };
  }

  if (status === 401 || meta.code === 'unauthorized' || lower.includes('unauthorized')) {
    return { type: 'error', code: 'auth_error', message, retryable: false };
  }
  if (status === 403) {
    return { type: 'error', code: 'forbidden', message, retryable: false };
  }
  if (status === 429 || lower.includes('rate limit')) {
    return { type: 'error', code: 'rate_limit', message, retryable: true };
  }
  if (status === 408 || lower.includes('timeout') || meta.code === 'ETIMEDOUT') {
    return { type: 'error', code: 'timeout', message, retryable: true };
  }
  if (status !== undefined && status >= 500 && status < 600) {
    return { type: 'error', code: 'upstream_error', message, retryable: true };
  }
  if (meta.code === 'ECONNRESET' || meta.code === 'ECONNREFUSED') {
    return { type: 'error', code: 'upstream_error', message, retryable: true };
  }

  return {
    type: 'error',
    code: meta.code ?? 'provider_exception',
    message,
    retryable: false,
  };
}

function extractMeta(err: unknown): ErrorWithStatus {
  if (!err) return {};
  if (typeof err === 'string') return { message: err };
  if (err instanceof Error) {
    const e = err as Error & ErrorWithStatus;
    const out: ErrorWithStatus = { message: e.message };
    if (typeof e.status === 'number') out.status = e.status;
    if (typeof e.statusCode === 'number' && out.status === undefined) {
      out.status = e.statusCode;
    }
    if (typeof e.code === 'string') out.code = e.code;
    return out;
  }
  if (typeof err === 'object') {
    return err as ErrorWithStatus;
  }
  return { message: String(err) };
}
