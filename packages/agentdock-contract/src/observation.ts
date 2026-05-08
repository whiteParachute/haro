import { z } from 'zod';
import { IsoDateTimeSchema, JsonValueSchema, NonEmptyStringSchema } from './primitives.js';

export const ObservationWindowSchema = z.object({
  since: IsoDateTimeSchema.optional(),
  until: IsoDateTimeSchema,
  cursor: NonEmptyStringSchema.optional(),
});

export const SessionObservationSchema = z.object({
  id: NonEmptyStringSchema,
  channel: NonEmptyStringSchema.optional(),
  runnerId: NonEmptyStringSchema.optional(),
  model: NonEmptyStringSchema.optional(),
  profile: NonEmptyStringSchema.optional(),
  startedAt: IsoDateTimeSchema.optional(),
  endedAt: IsoDateTimeSchema.optional(),
});

export const TurnObservationSchema = z.object({
  id: NonEmptyStringSchema,
  sessionId: NonEmptyStringSchema,
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  contentRef: NonEmptyStringSchema.optional(),
  contentExcerpt: z.string().max(500).optional(),
  createdAt: IsoDateTimeSchema,
});

export const ToolCallObservationSchema = z.object({
  id: NonEmptyStringSchema,
  sessionId: NonEmptyStringSchema,
  toolName: NonEmptyStringSchema,
  status: z.enum(['success', 'error', 'pending', 'timeout']),
  startedAt: IsoDateTimeSchema,
  endedAt: IsoDateTimeSchema.optional(),
  resultRef: NonEmptyStringSchema.optional(),
  errorCode: NonEmptyStringSchema.optional(),
});

export const ScheduledTaskRunObservationSchema = z.object({
  id: NonEmptyStringSchema,
  taskId: NonEmptyStringSchema,
  executionType: z.enum(['agent', 'script']),
  status: z.enum(['success', 'error', 'skipped', 'running']),
  startedAt: IsoDateTimeSchema,
  endedAt: IsoDateTimeSchema.optional(),
  resultRef: NonEmptyStringSchema.optional(),
});

export const MemoryMaintenanceObservationSchema = z.object({
  id: NonEmptyStringSchema,
  kind: z.enum(['wrapup', 'sleep', 'prune', 'repair']),
  status: z.enum(['success', 'error', 'skipped']),
  startedAt: IsoDateTimeSchema,
  endedAt: IsoDateTimeSchema.optional(),
  logRef: NonEmptyStringSchema.optional(),
});

export const RunnerErrorObservationSchema = z.object({
  id: NonEmptyStringSchema,
  sessionId: NonEmptyStringSchema.optional(),
  runnerId: NonEmptyStringSchema.optional(),
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
  recoverable: z.boolean(),
  occurredAt: IsoDateTimeSchema,
  detailsRef: NonEmptyStringSchema.optional(),
});

export const UsageRecordObservationSchema = z.object({
  id: NonEmptyStringSchema,
  sessionId: NonEmptyStringSchema.optional(),
  model: NonEmptyStringSchema.optional(),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  estimatedCost: z.number().nonnegative().optional(),
  recordedAt: IsoDateTimeSchema,
});

export const ObservationBatchSchema = z.object({
  id: NonEmptyStringSchema,
  connectionId: NonEmptyStringSchema,
  source: NonEmptyStringSchema,
  collectedAt: IsoDateTimeSchema,
  window: ObservationWindowSchema,
  sessions: z.array(SessionObservationSchema).default([]),
  turns: z.array(TurnObservationSchema).default([]),
  toolCalls: z.array(ToolCallObservationSchema).default([]),
  scheduledTaskRuns: z.array(ScheduledTaskRunObservationSchema).default([]),
  memoryMaintenanceLogs: z.array(MemoryMaintenanceObservationSchema).default([]),
  runnerErrors: z.array(RunnerErrorObservationSchema).default([]),
  usageRecords: z.array(UsageRecordObservationSchema).default([]),
  rawRefs: z.array(NonEmptyStringSchema).default([]),
  metadata: z.record(JsonValueSchema).default({}),
});

export type ObservationWindow = z.infer<typeof ObservationWindowSchema>;
export type SessionObservation = z.infer<typeof SessionObservationSchema>;
export type TurnObservation = z.infer<typeof TurnObservationSchema>;
export type ToolCallObservation = z.infer<typeof ToolCallObservationSchema>;
export type ScheduledTaskRunObservation = z.infer<typeof ScheduledTaskRunObservationSchema>;
export type MemoryMaintenanceObservation = z.infer<typeof MemoryMaintenanceObservationSchema>;
export type RunnerErrorObservation = z.infer<typeof RunnerErrorObservationSchema>;
export type UsageRecordObservation = z.infer<typeof UsageRecordObservationSchema>;
export type ObservationBatch = z.infer<typeof ObservationBatchSchema>;
