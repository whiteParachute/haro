import { z } from 'zod';
import { IsoDateTimeSchema, NonEmptyStringSchema, RefSchema } from './primitives.js';
import {
  EvolutionLevelSchema,
  ProposalTargetKindSchema,
  RollbackPlanSchema,
} from './proposal.js';

export const ApprovalRequestStatusSchema = z.enum(['pending']);
export const ApprovalDecisionOptionSchema = z.enum(['approve', 'reject', 'request-changes']);

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

export type ApprovalRequestStatus = z.infer<typeof ApprovalRequestStatusSchema>;
export type ApprovalDecisionOption = z.infer<typeof ApprovalDecisionOptionSchema>;
export type ApprovalRequestRecord = z.infer<typeof ApprovalRequestRecordSchema>;
