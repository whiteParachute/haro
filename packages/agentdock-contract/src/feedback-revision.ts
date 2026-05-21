import { z } from 'zod';
import { IsoDateTimeSchema, NonEmptyStringSchema, RefSchema } from './primitives.js';

export const DEFAULT_FEEDBACK_REVISION_DEPTH_LIMIT = 3;

export const FeedbackRequirementCategorySchema = z.enum([
  'scope-reduction',
  'evidence-required',
  'risk-rollback-change',
  'duplicate-merge',
  'readability',
  'implementation-detail',
  'needs-more-info',
  'out-of-scope',
  'policy-blocked',
]);

export const FeedbackRequirementDispositionSchema = z.enum([
  'incorporated',
  'partially-incorporated',
  'not-applicable',
  'deferred',
  'blocked',
  'needs-human',
]);

export const FeedbackRequirementResolutionSchema = z.object({
  id: NonEmptyStringSchema,
  category: FeedbackRequirementCategorySchema,
  disposition: FeedbackRequirementDispositionSchema,
  userText: NonEmptyStringSchema,
  normalizedRequirement: NonEmptyStringSchema,
  proposalChangeRefs: z.array(RefSchema).default([]),
  evidenceRefs: z.array(RefSchema).default([]),
  explanation: NonEmptyStringSchema,
});

export const RevisionNoOpVerdictSchema = z.enum([
  'substantive-change',
  'no-op',
  'manual-check',
]);

export const RevisionChangedFieldSchema = z.enum([
  'title',
  'changeSet',
  'contentRef',
  'contentHash',
  'sourceObservationRefs',
  'testPlan',
  'rollbackPlan',
  'riskLevel',
  'scope',
  'evidenceRefs',
  'description',
]);

export const RevisionNoOpCheckSchema = z.object({
  verdict: RevisionNoOpVerdictSchema,
  priorProposalContentHashes: z.array(NonEmptyStringSchema).default([]),
  revisedProposalContentHashes: z.array(NonEmptyStringSchema).default([]),
  priorSemanticFingerprint: NonEmptyStringSchema.optional(),
  revisedSemanticFingerprint: NonEmptyStringSchema.optional(),
  revisionDepth: z.number().int().nonnegative(),
  changedFields: z.array(RevisionChangedFieldSchema).default([]),
  reason: NonEmptyStringSchema,
});

export const ProposalRevisionMetadataSchema = z.object({
  revisionId: NonEmptyStringSchema,
  rootProposalId: NonEmptyStringSchema,
  revisionOfProposalId: NonEmptyStringSchema,
  revisionDepth: z.number().int().nonnegative(),
  sourceApprovalRequestId: NonEmptyStringSchema,
  sourceDecisionId: NonEmptyStringSchema,
  sourceDecisionDirection: NonEmptyStringSchema,
  sourceConversationRefs: z.array(NonEmptyStringSchema).default([]),
  rewritePlanRef: RefSchema.optional(),
  supersedesProposalIds: z.array(NonEmptyStringSchema).default([]),
  supersedesBlockedEventIds: z.array(NonEmptyStringSchema).default([]),
  resubmissionReason: NonEmptyStringSchema,
  incorporatedFeedback: z.array(FeedbackRequirementResolutionSchema).default([]),
  unresolvedFeedback: z.array(FeedbackRequirementResolutionSchema).default([]),
  noOpCheck: RevisionNoOpCheckSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const FeedbackRevisionStatusSchema = z.enum([
  'planned',
  'revised',
  'blocked',
  'manual-check',
  'superseded',
]);

export const FeedbackRewriteActionSchema = z.object({
  action: z.enum([
    'narrow-scope',
    'add-evidence',
    'change-risk-or-rollback',
    'merge-duplicate',
    'rewrite-description',
    'ask-for-more-info',
    'block',
  ]),
  summary: NonEmptyStringSchema,
  targetRefs: z.array(RefSchema).default([]),
});

export const FeedbackRevisionRecordSchema = z.object({
  id: NonEmptyStringSchema,
  status: FeedbackRevisionStatusSchema,
  rootProposalId: NonEmptyStringSchema,
  sourceProposalId: NonEmptyStringSchema,
  sourceApprovalRequestId: NonEmptyStringSchema,
  sourceDecisionId: NonEmptyStringSchema,
  sourceDecisionDirection: NonEmptyStringSchema,
  revisedProposalId: NonEmptyStringSchema.optional(),
  revisedValidationId: NonEmptyStringSchema.optional(),
  revisedApprovalRequestId: NonEmptyStringSchema.optional(),
  parsedRequirements: z.array(FeedbackRequirementResolutionSchema).default([]),
  rewriteActions: z.array(FeedbackRewriteActionSchema).default([]),
  noOpCheck: RevisionNoOpCheckSchema,
  blockingReasons: z.array(NonEmptyStringSchema).default([]),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).superRefine((record, ctx) => {
  if (record.status === 'revised' && !record.revisedProposalId?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['revisedProposalId'],
      message: 'revised feedback revision records require revisedProposalId',
    });
  }

  if (record.status === 'blocked' && record.blockingReasons.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['blockingReasons'],
      message: 'blocked feedback revision records require blockingReasons',
    });
  }
});

export type FeedbackRequirementCategory = z.infer<typeof FeedbackRequirementCategorySchema>;
export type FeedbackRequirementDisposition = z.infer<typeof FeedbackRequirementDispositionSchema>;
export type FeedbackRequirementResolution = z.infer<typeof FeedbackRequirementResolutionSchema>;
export type RevisionNoOpVerdict = z.infer<typeof RevisionNoOpVerdictSchema>;
export type RevisionChangedField = z.infer<typeof RevisionChangedFieldSchema>;
export type RevisionNoOpCheck = z.infer<typeof RevisionNoOpCheckSchema>;
export type ProposalRevisionMetadata = z.infer<typeof ProposalRevisionMetadataSchema>;
export type FeedbackRevisionStatus = z.infer<typeof FeedbackRevisionStatusSchema>;
export type FeedbackRewriteAction = z.infer<typeof FeedbackRewriteActionSchema>;
export type FeedbackRevisionRecord = z.infer<typeof FeedbackRevisionRecordSchema>;
