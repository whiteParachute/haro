import { z } from 'zod';
import { IsoDateTimeSchema, NonEmptyStringSchema, RefSchema } from './primitives.js';
import {
  EvolutionLevelSchema,
  ProposalTargetKindSchema,
  RollbackPlanSchema,
} from './proposal.js';

export const ApprovalRequestStatusSchema = z.enum(['pending']);
export const ApprovalDecisionOptionSchema = z.enum(['approve', 'reject', 'request-changes']);

export const ApprovalDecisionReviewerSchema = z.object({
  source: NonEmptyStringSchema,
  userId: NonEmptyStringSchema.optional(),
  username: NonEmptyStringSchema.optional(),
  role: NonEmptyStringSchema.optional(),
});

export const ApprovalRequestRecordSchema = z.object({
  id: NonEmptyStringSchema,
  proposalId: NonEmptyStringSchema,
  validationId: NonEmptyStringSchema,
  status: ApprovalRequestStatusSchema,
  title: NonEmptyStringSchema,
  level: EvolutionLevelSchema,
  targetKind: ProposalTargetKindSchema,
  riskLevel: z.enum(['low', 'medium', 'high']),
  sourceRef: RefSchema,
  validationRef: RefSchema,
  whyChange: z.array(NonEmptyStringSchema).min(1),
  howChange: z.array(NonEmptyStringSchema).min(1),
  expectedBenefits: z.array(NonEmptyStringSchema).min(1),
  requiredTests: z.array(NonEmptyStringSchema).default([]),
  manualChecks: z.array(NonEmptyStringSchema).default([]),
  regressionRisks: z.array(NonEmptyStringSchema).default([]),
  rollbackPlan: RollbackPlanSchema,
  decisionOptions: z.array(ApprovalDecisionOptionSchema).min(3),
  reviewerInstruction: NonEmptyStringSchema,
  humanReviewRequired: z.literal(true),
  evidenceRefs: z.array(RefSchema).default([]),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const ApprovalDecisionRecordSchema = z.object({
  id: NonEmptyStringSchema,
  approvalRequestId: NonEmptyStringSchema,
  proposalId: NonEmptyStringSchema,
  validationId: NonEmptyStringSchema,
  decision: ApprovalDecisionOptionSchema,
  direction: NonEmptyStringSchema.optional(),
  reviewer: ApprovalDecisionReviewerSchema,
  sourceRef: RefSchema,
  approvalRef: RefSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).superRefine((record, ctx) => {
  if (record.decision === 'request-changes' && !record.direction?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['direction'],
      message: 'request-changes decisions require direction',
    });
  }
});

export type ApprovalRequestStatus = z.infer<typeof ApprovalRequestStatusSchema>;
export type ApprovalDecisionOption = z.infer<typeof ApprovalDecisionOptionSchema>;
export type ApprovalDecisionReviewer = z.infer<typeof ApprovalDecisionReviewerSchema>;
export type ApprovalDecisionRecord = z.infer<typeof ApprovalDecisionRecordSchema>;
export type ApprovalRequestRecord = z.infer<typeof ApprovalRequestRecordSchema>;
