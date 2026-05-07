/**
 * schedule_task tool (FEAT-032 R7 / AC4).
 *
 * Validates `when` (ISO timestamp for one-shot, cron expression for recurring)
 * before delegating to services.cron.createJob. The cron validation reuses
 * cron-parser to surface invalid expressions early so the registry returns
 * INVALID_PARAMS instead of letting the cron layer raise an opaque error.
 */

import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import { cron as cronService } from '@haro/core/services';
import type { CreateCronJobInput } from '@haro/core/cron';
import { isHaroError } from '@haro/core/errors';
import { McpToolError } from '../error.js';
import type { ToolDefinition } from '../types.js';

// Mirrors `packages/core/src/cron/manager.ts` ISO8601_STRICT so the tool's
// validation tracks the storage layer's. Pre-validating here means callers
// see INVALID_PARAMS instead of the generic INTERNAL_ERROR remap below.
const ISO8601_STRICT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const ScheduleModeSchema = z.enum(['cron', 'once']);

const RetryPolicySchema = z.object({
  max: z.number().int().nonnegative().max(20),
  backoff: z.enum(['exponential', 'linear', 'fixed']),
});

export const ScheduleTaskInputSchema = z.object({
  when: z.string().min(1),
  mode: ScheduleModeSchema,
  taskInput: z.string().min(1).max(64 * 1024),
  retryPolicy: RetryPolicySchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ScheduleTaskInput = z.infer<typeof ScheduleTaskInputSchema>;

export interface ScheduleTaskOutput {
  jobId: string;
  mode: 'cron' | 'once';
  whenExpr: string;
  status: string;
  nextRunAt: number | null;
}

export const scheduleTaskTool: ToolDefinition<typeof ScheduleTaskInputSchema, ScheduleTaskOutput> = {
  name: 'schedule_task',
  description:
    "Schedule a future agent task. mode='once' takes an ISO timestamp; mode='cron' takes a cron expression (optional 'TZ=Asia/Shanghai ' prefix). taskInput is the prompt fed to AgentRunner.run when the schedule fires.",
  inputSchema: ScheduleTaskInputSchema,
  timeoutMs: 1_000,
  async execute(params, ctx): Promise<ScheduleTaskOutput> {
    if (params.mode === 'once') {
      if (!ISO8601_STRICT.test(params.when)) {
        throw new McpToolError(
          'INVALID_PARAMS',
          `'when' must be a strict ISO-8601 timestamp with Z or ±HH:MM offset (got '${params.when}')`,
          'Use forms like 2026-05-15T09:00:00+08:00 or 2026-05-15T01:00:00Z.',
        );
      }
      const ts = Date.parse(params.when);
      if (!Number.isFinite(ts)) {
        throw new McpToolError(
          'INVALID_PARAMS',
          `'when' is not a parseable ISO timestamp: ${params.when}`,
        );
      }
      if (ts <= ctx.now().getTime()) {
        throw new McpToolError(
          'INVALID_PARAMS',
          `'when' is in the past or now (${params.when})`,
        );
      }
    } else {
      try {
        // The cron storage layer accepts an optional 'TZ=Region/City ' prefix.
        const expression = params.when.startsWith('TZ=')
          ? params.when.split(' ').slice(1).join(' ').trim()
          : params.when;
        if (expression.length === 0) {
          throw new Error('cron expression is empty');
        }
        CronExpressionParser.parse(expression);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new McpToolError('INVALID_PARAMS', `invalid cron expression: ${message}`);
      }
    }

    const input: CreateCronJobInput = {
      sessionId: ctx.session.sessionId,
      agentId: ctx.session.agentId,
      mode: params.mode,
      when: params.when,
      taskInput: params.taskInput,
      ...(params.retryPolicy ? { retryPolicy: params.retryPolicy } : {}),
      ...(params.metadata ? { metadata: params.metadata } : {}),
    };
    let job;
    try {
      job = cronService.createJob(ctx.deps.serviceContext, input);
    } catch (err) {
      // Spec R7 / AC4: validation failures originating from the cron storage
      // (invalid TZ, expression-too-frequent, quota exceeded) must surface as
      // INVALID_PARAMS instead of INTERNAL_ERROR so the agent's retry logic
      // doesn't loop on a non-retryable input. HaroError carries the user-
      // facing remediation we want to forward verbatim.
      if (isHaroError(err)) {
        const code = err.code === 'CRON_QUOTA_EXCEEDED' ? 'PERMISSION_DENIED' : 'INVALID_PARAMS';
        throw new McpToolError(code, err.message, err.remediation);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new McpToolError('INTERNAL_ERROR', `services.cron.createJob failed: ${message}`);
    }
    return {
      jobId: job.id,
      mode: job.mode,
      whenExpr: job.whenExpr,
      status: job.status,
      nextRunAt: job.nextRunAt,
    };
  },
};
