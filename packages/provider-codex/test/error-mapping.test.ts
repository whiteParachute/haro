/** FEAT-003 §5 错误处理 + AC3 + AC7. */
import { describe, it, expect } from 'vitest';
import { mapCodexError, SAVE_AND_CLEAR_HINT } from '../src/error-mapping.js';

function err(status: number | undefined, message: string, code?: string) {
  const e = new Error(message) as Error & {
    status?: number;
    code?: string;
  };
  if (status !== undefined) e.status = status;
  if (code) e.code = code;
  return e;
}

describe('mapCodexError [FEAT-003]', () => {
  it('AC3: 401 → auth_error, retryable=false', () => {
    expect(mapCodexError(err(401, 'Unauthorized'))).toMatchObject({
      type: 'error',
      code: 'auth_error',
      retryable: false,
    });
  });

  it('429 → rate_limit, retryable=true', () => {
    expect(mapCodexError(err(429, 'rate limited'))).toMatchObject({
      code: 'rate_limit',
      retryable: true,
    });
  });

  it('408 / "timeout" string → timeout, retryable=true', () => {
    expect(mapCodexError(err(408, 'request timeout'))).toMatchObject({
      code: 'timeout',
      retryable: true,
    });
    expect(mapCodexError(err(undefined, 'socket timeout'))).toMatchObject({
      code: 'timeout',
      retryable: true,
    });
  });

  it('5xx → upstream_error, retryable=true', () => {
    expect(mapCodexError(err(503, 'service unavailable'))).toMatchObject({
      code: 'upstream_error',
      retryable: true,
    });
  });

  it('AC7: context length errors carry hint=save-and-clear', () => {
    const inputs = [
      'context length exceeded',
      "model's maximum context length is 128000",
      'context_length_exceeded',
      'context window full',
    ];
    for (const msg of inputs) {
      const ev = mapCodexError(err(undefined, msg));
      expect(ev.code).toBe('context_too_long');
      expect(ev.retryable).toBe(false);
      expect(ev.hint).toBe(SAVE_AND_CLEAR_HINT);
    }
  });

  it('unknown errors fall back to provider_exception', () => {
    expect(mapCodexError(err(undefined, 'mystery'))).toMatchObject({
      code: 'provider_exception',
      retryable: false,
    });
  });

  it('plain strings still map cleanly', () => {
    expect(mapCodexError('boom')).toMatchObject({
      type: 'error',
      message: 'boom',
      retryable: false,
    });
  });
});
