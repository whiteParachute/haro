import { z } from 'zod';
import { IsoDateTimeSchema, NonEmptyStringSchema, RefSchema } from './primitives.js';
import { EvolutionLevelSchema, ProposalTargetKindSchema } from './proposal.js';

export const ApplyGateCodeSchema = z.enum([
  'READY',
  'PROPOSAL_NOT_FOUND',
  'VALIDATION_REQUIRED',
  'APPLY_NOT_ELIGIBLE',
  'DIRECT_APPLY_FORBIDDEN',
  'SNAPSHOT_FAILED',
  'ROLLBACK_REF_REQUIRED',
  'UNSUPPORTED_TARGET_KIND',
]);

export const ApplicationStatusSchema = z.enum([
  'ready',
  'blocked',
  'applied',
  'rolled-back',
]);

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
});

export type ApplyGateCode = z.infer<typeof ApplyGateCodeSchema>;
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;
export type ApplicationRecord = z.infer<typeof ApplicationRecordSchema>;
