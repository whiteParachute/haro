/** FEAT-033 R7 — cron expression parser & frequency validator. */
import { describe, it, expect } from 'vitest';
import {
  parseCronExpression,
  nextRunAfter,
  minObservedIntervalMs,
  assertCronFrequencyAllowed,
} from '../src/cron/cron-parser.js';
import { isHaroError } from '../src/errors/index.js';

describe('parseCronExpression', () => {
  it('accepts a 5-field expression', () => {
    const parsed = parseCronExpression('*/5 * * * *');
    expect(parsed.expression).toBe('*/5 * * * *');
    expect(parsed.timezone).toBeUndefined();
  });

  it('accepts a 6-field expression with seconds', () => {
    const parsed = parseCronExpression('0 */5 * * * *');
    expect(parsed.expression).toBe('0 */5 * * * *');
  });

  it('extracts a TZ= prefix', () => {
    const parsed = parseCronExpression('TZ=Asia/Shanghai 0 9 * * *');
    expect(parsed.expression).toBe('0 9 * * *');
    expect(parsed.timezone).toBe('Asia/Shanghai');
  });

  it('rejects garbage with CRON_INVALID_EXPRESSION', () => {
    let err: unknown;
    try {
      parseCronExpression('not a cron expr');
    } catch (e) {
      err = e;
    }
    expect(isHaroError(err)).toBe(true);
    if (isHaroError(err)) expect(err.code).toBe('CRON_INVALID_EXPRESSION');
  });

  it('rejects empty input', () => {
    expect(() => parseCronExpression('   ')).toThrowError(/CRON_INVALID_EXPRESSION|non-empty/);
  });
});

describe('nextRunAfter', () => {
  it('returns a future epoch ms greater than the reference', () => {
    const parsed = parseCronExpression('0 9 * * *');
    const from = new Date('2026-05-02T05:00:00Z');
    const next = nextRunAfter(parsed, from);
    expect(next).toBeGreaterThan(from.getTime());
  });
});

describe('minObservedIntervalMs', () => {
  it('reports 60s for "* * * * *"', () => {
    const parsed = parseCronExpression('* * * * *');
    expect(minObservedIntervalMs(parsed)).toBe(60_000);
  });

  it('reports 5*60s for "*/5 * * * *"', () => {
    const parsed = parseCronExpression('*/5 * * * *');
    expect(minObservedIntervalMs(parsed)).toBe(5 * 60_000);
  });

  it('detects sub-minute firing for 6-field "*/30 * * * * *"', () => {
    const parsed = parseCronExpression('*/30 * * * * *');
    expect(minObservedIntervalMs(parsed)).toBe(30_000);
  });

  it('detects every-second pattern "* * * * * *"', () => {
    const parsed = parseCronExpression('* * * * * *');
    expect(minObservedIntervalMs(parsed)).toBe(1_000);
  });
});

describe('assertCronFrequencyAllowed', () => {
  it('accepts every-minute', () => {
    const parsed = parseCronExpression('* * * * *');
    expect(() => assertCronFrequencyAllowed(parsed)).not.toThrow();
  });

  it('rejects every-second with CRON_FREQUENCY_TOO_HIGH', () => {
    const parsed = parseCronExpression('* * * * * *');
    let err: unknown;
    try {
      assertCronFrequencyAllowed(parsed);
    } catch (e) {
      err = e;
    }
    expect(isHaroError(err)).toBe(true);
    if (isHaroError(err)) {
      expect(err.code).toBe('CRON_FREQUENCY_TOO_HIGH');
      expect(err.remediation).toMatch(/≥1 minute|min/i);
    }
  });

  it('rejects sub-minute 6-field patterns', () => {
    const parsed = parseCronExpression('*/30 * * * * *');
    expect(() => assertCronFrequencyAllowed(parsed)).toThrowError(/CRON_FREQUENCY_TOO_HIGH|fires every/);
  });
});
