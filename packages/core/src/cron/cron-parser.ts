/**
 * Thin wrapper around the `cron-parser` library (FEAT-033 R3 / R7).
 *
 * Responsibilities:
 *  - Validate cron expressions (5/6 fields, optional `TZ=Asia/Shanghai ` prefix).
 *  - Compute `nextRunAfter(parsed, from)` — used by manager.create / runner advance.
 *  - Probe min observed firing interval to enforce ≥1 minute frequency floor.
 *
 * NOT responsible for scheduling / firing — `tick()` (FEAT-033 R11) owns that.
 */

import { CronExpressionParser } from 'cron-parser';
import { HaroError } from '../errors/index.js';
import { MIN_CRON_INTERVAL_MS } from './types.js';

export interface CronParseResult {
  raw: string;
  expression: string;
  timezone: string | undefined;
}

const TZ_PREFIX = /^TZ=([^\s]+)\s+(.+)$/;

export function parseCronExpression(raw: string): CronParseResult {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new HaroError('CRON_INVALID_EXPRESSION', 'Cron expression must be a non-empty string.');
  }
  const match = raw.match(TZ_PREFIX);
  const expression = match ? match[2]! : raw;
  const timezone = match ? match[1] : undefined;
  try {
    CronExpressionParser.parse(expression, timezone ? { tz: timezone } : {});
  } catch (cause) {
    throw new HaroError(
      'CRON_INVALID_EXPRESSION',
      `Invalid cron expression: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        remediation:
          'Use 5 fields (minute hour dom month dow) or 6 fields with seconds. Optional `TZ=<zone>` prefix.',
        cause,
      },
    );
  }
  return { raw, expression, timezone };
}

/** Compute the next firing strictly after `from` (epoch ms). Returns epoch ms. */
export function nextRunAfter(parsed: CronParseResult, from: Date): number {
  const interval = CronExpressionParser.parse(parsed.expression, {
    currentDate: from,
    ...(parsed.timezone ? { tz: parsed.timezone } : {}),
  });
  return interval.next().toDate().getTime();
}

/**
 * Probe the cron pattern by walking `samples` consecutive firings from a
 * stable reference point and returning the minimum observed delta in ms.
 * Used to reject expressions that fire faster than `MIN_CRON_INTERVAL_MS`.
 *
 * Why probe instead of static analysis: cron grammars (steps, ranges, lists,
 * specials) make a closed-form lower bound non-trivial; 16 samples give a
 * tight bound on every realistic pattern while staying O(ms).
 */
export function minObservedIntervalMs(parsed: CronParseResult, samples = 16): number {
  const ref = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
  const interval = CronExpressionParser.parse(parsed.expression, {
    currentDate: ref,
    ...(parsed.timezone ? { tz: parsed.timezone } : {}),
  });
  let prev = interval.next().toDate().getTime();
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < samples; i++) {
    const next = interval.next().toDate().getTime();
    const delta = next - prev;
    if (delta > 0 && delta < min) min = delta;
    prev = next;
  }
  return Number.isFinite(min) ? min : Number.MAX_SAFE_INTEGER;
}

export function assertCronFrequencyAllowed(parsed: CronParseResult): void {
  const min = minObservedIntervalMs(parsed);
  if (min < MIN_CRON_INTERVAL_MS) {
    throw new HaroError(
      'CRON_FREQUENCY_TOO_HIGH',
      `Cron expression '${parsed.raw}' fires every ${min}ms (min observed); minimum interval is ${MIN_CRON_INTERVAL_MS}ms.`,
      {
        remediation:
          'Loosen the schedule to ≥1 minute, or run a long-lived script outside the cron subsystem.',
      },
    );
  }
}
