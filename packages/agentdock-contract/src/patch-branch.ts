import { z } from 'zod';
import { IsoDateTimeSchema, NonEmptyStringSchema, RefSchema } from './primitives.js';
import {
  EvolutionLevelSchema,
  ProposalTargetKindSchema,
  RollbackPlanSchema,
} from './proposal.js';

export const PatchBranchPlanStatusSchema = z.enum(['planned']);

export const PatchBranchPlanRecordSchema = z.object({
  id: NonEmptyStringSchema,
  proposalId: NonEmptyStringSchema,
  validationId: NonEmptyStringSchema,
  status: PatchBranchPlanStatusSchema,
  level: EvolutionLevelSchema,
  targetKind: ProposalTargetKindSchema,
  sourceRef: RefSchema,
  validationRef: RefSchema,
  branchName: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema.optional(),
  changeRefs: z.array(RefSchema).min(1),
  requiredTests: z.array(NonEmptyStringSchema).default([]),
  manualChecks: z.array(NonEmptyStringSchema).default([]),
  regressionRisks: z.array(NonEmptyStringSchema).default([]),
  rollbackPlan: RollbackPlanSchema,
  humanReviewRequired: z.literal(true),
  evidenceRefs: z.array(RefSchema).default([]),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).superRefine((record, ctx) => {
  if (record.level !== 'L2' && record.level !== 'L3') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['level'],
      message: 'patch branch plans are only valid for L2/L3 proposals',
    });
  }
});

export type PatchBranchPlanStatus = z.infer<typeof PatchBranchPlanStatusSchema>;
export type PatchBranchPlanRecord = z.infer<typeof PatchBranchPlanRecordSchema>;
