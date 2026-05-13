import { z } from 'zod';
import { IsoDateTimeSchema, NonEmptyStringSchema, RefSchema } from './primitives.js';

export const AssetKindSchema = z.enum([
  'skill',
  'prompt',
  'runner-profile',
  'routing-rule',
  'mcp-tool-config',
  'schedule-config',
  'frontier-source-ref',
  'archive',
]);

export const AssetStatusSchema = z.enum([
  'proposed',
  'validated',
  'applied',
  'rolled-back',
  'archived',
  'rejected',
  'superseded',
]);

export const AssetEventTypeSchema = z.enum([
  'proposed',
  'validated',
  'applied',
  'rolled-back',
  'archived',
  'rejected',
  'superseded',
  'used',
]);

export const RollbackMetadataSchema = z.object({
  rollbackRef: RefSchema.optional(),
  snapshotRef: RefSchema.optional(),
  reversible: z.boolean(),
});

export const AssetEventSchema = z.object({
  id: NonEmptyStringSchema,
  assetId: NonEmptyStringSchema,
  kind: AssetKindSchema,
  version: NonEmptyStringSchema,
  sourceRef: RefSchema,
  contentRef: RefSchema,
  contentHash: NonEmptyStringSchema,
  status: AssetStatusSchema,
  eventType: AssetEventTypeSchema,
  actor: z.enum(['agent', 'haro', 'user', 'system']),
  proposalRef: RefSchema.optional(),
  validationRef: RefSchema.optional(),
  rollbackMetadata: RollbackMetadataSchema.optional(),
  createdAt: IsoDateTimeSchema,
});

export type AssetKind = z.infer<typeof AssetKindSchema>;
export type AssetStatus = z.infer<typeof AssetStatusSchema>;
export type AssetEventType = z.infer<typeof AssetEventTypeSchema>;
export type RollbackMetadata = z.infer<typeof RollbackMetadataSchema>;
export type AssetEvent = z.infer<typeof AssetEventSchema>;
