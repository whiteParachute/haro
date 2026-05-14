import { z } from 'zod';
import { IsoDateTimeSchema, NonEmptyStringSchema, RefSchema } from './primitives.js';
import { EvolutionLevelSchema, ProposalTargetKindSchema } from './proposal.js';

export const ApplyGateCodeSchema = z.enum([
  'READY',
  'PROPOSAL_NOT_FOUND',
  'VALIDATION_REQUIRED',
  'HUMAN_REVIEW_REQUIRED',
  'APPROVAL_REJECTED',
  'CHANGES_REQUESTED',
  'APPLY_NOT_ELIGIBLE',
  'DIRECT_APPLY_FORBIDDEN',
  'SNAPSHOT_FAILED',
  'ROLLBACK_REF_REQUIRED',
  'UNSUPPORTED_TARGET_KIND',
  'UNSUPPORTED_APPLY_EXECUTOR',
  'UNSUPPORTED_CHANGE_OPERATION',
  'APPLY_CONTENT_REQUIRED',
  'APPLY_CONTENT_HASH_MISMATCH',
  'APPLY_EXECUTION_FAILED',
]);

export const ApplicationStatusSchema = z.enum([
  'ready',
  'blocked',
  'applied',
  'rolled-back',
]);

export const SnapshotSourceSchema = z.enum([
  'target-content',
  'sidecar-ledger',
  'absent',
]);

export const SnapshotEntrySchema = z.object({
  changeIndex: z.number().int().nonnegative(),
  targetRef: RefSchema,
  assetId: NonEmptyStringSchema,
  existed: z.boolean(),
  snapshotSource: SnapshotSourceSchema.optional(),
  latestEventRef: RefSchema.optional(),
  sourceContentRef: RefSchema.optional(),
  contentRef: RefSchema.optional(),
  contentHash: NonEmptyStringSchema.optional(),
  version: NonEmptyStringSchema.optional(),
  status: NonEmptyStringSchema.optional(),
});

export const AssetSnapshotRecordSchema = z.object({
  id: NonEmptyStringSchema,
  proposalId: NonEmptyStringSchema,
  validationId: NonEmptyStringSchema.optional(),
  level: EvolutionLevelSchema,
  targetKind: ProposalTargetKindSchema,
  sourceRef: RefSchema,
  entries: z.array(SnapshotEntrySchema).min(1),
  createdAt: IsoDateTimeSchema,
});

export const RollbackActionSchema = z.enum([
  'restore-latest-event',
  'delete-created-asset',
]);

export const RollbackEntrySchema = z.object({
  changeIndex: z.number().int().nonnegative(),
  targetRef: RefSchema,
  assetId: NonEmptyStringSchema,
  action: RollbackActionSchema,
  existedBefore: z.boolean(),
  restoreEventRef: RefSchema.optional(),
  restoreContentRef: RefSchema.optional(),
  restoreContentHash: NonEmptyStringSchema.optional(),
  restoreVersion: NonEmptyStringSchema.optional(),
});

export const RollbackRecordSchema = z.object({
  id: NonEmptyStringSchema,
  proposalId: NonEmptyStringSchema,
  validationId: NonEmptyStringSchema.optional(),
  snapshotRef: RefSchema,
  sourceRef: RefSchema,
  reversible: z.boolean(),
  entries: z.array(RollbackEntrySchema).min(1),
  createdAt: IsoDateTimeSchema,
});

export const ApplicationRecordSchema = z.object({
  id: NonEmptyStringSchema,
  proposalId: NonEmptyStringSchema,
  validationId: NonEmptyStringSchema,
  status: ApplicationStatusSchema,
  gateCode: ApplyGateCodeSchema,
  level: EvolutionLevelSchema,
  targetKind: ProposalTargetKindSchema,
  applied: z.boolean(),
  snapshotRef: RefSchema.optional(),
  rollbackRef: RefSchema.optional(),
  assetEventRefs: z.array(RefSchema).default([]),
  evidenceRefs: z.array(RefSchema).default([]),
  blockingReasons: z.array(NonEmptyStringSchema).default([]),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).superRefine((record, ctx) => {
  if (record.status === 'ready' && record.gateCode !== 'READY') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['gateCode'],
      message: 'ready application records require gateCode=READY',
    });
  }

  if (record.status !== 'blocked' && record.gateCode !== 'READY') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['gateCode'],
      message: 'non-blocked application records require gateCode=READY',
    });
  }

  if (record.status === 'blocked' && record.gateCode === 'READY') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['gateCode'],
      message: 'blocked application records require a non-READY gate code',
    });
  }

  if (record.gateCode === 'READY' && record.blockingReasons.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['blockingReasons'],
      message: 'READY application records must not include blocking reasons',
    });
  }

  if (record.status !== 'blocked' && (!record.snapshotRef || !record.rollbackRef)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['snapshotRef'],
      message: 'non-blocked application records require snapshotRef and rollbackRef',
    });
  }

  if (record.status === 'applied' && !record.applied) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['applied'],
      message: 'applied application records require applied=true',
    });
  }

  if (record.status !== 'applied' && record.applied) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['applied'],
      message: 'only status=applied may set applied=true',
    });
  }
});

export type ApplyGateCode = z.infer<typeof ApplyGateCodeSchema>;
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;
export type SnapshotSource = z.infer<typeof SnapshotSourceSchema>;
export type SnapshotEntry = z.infer<typeof SnapshotEntrySchema>;
export type AssetSnapshotRecord = z.infer<typeof AssetSnapshotRecordSchema>;
export type RollbackAction = z.infer<typeof RollbackActionSchema>;
export type RollbackEntry = z.infer<typeof RollbackEntrySchema>;
export type RollbackRecord = z.infer<typeof RollbackRecordSchema>;
export type ApplicationRecord = z.infer<typeof ApplicationRecordSchema>;
