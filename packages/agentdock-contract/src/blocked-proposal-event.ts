import { z } from 'zod';
import { IsoDateTimeSchema, NonEmptyStringSchema, RefSchema } from './primitives.js';

export const BlockedProposalReasonSchema = z.enum(['AWAITING_FEEDBACK_INCORPORATION']);

export const BlockedProposalEventSchema = z.object({
  id: NonEmptyStringSchema,
  status: z.literal('blocked'),
  reason: BlockedProposalReasonSchema,
  candidateProposalId: NonEmptyStringSchema,
  priorDecisionId: NonEmptyStringSchema,
  priorProposalId: NonEmptyStringSchema,
  priorDirection: NonEmptyStringSchema.optional(),
  targetRef: RefSchema,
  targetRefs: z.array(RefSchema).min(1),
  contentHash: NonEmptyStringSchema,
  contentHashes: z.array(NonEmptyStringSchema).default([]),
  semanticFingerprint: NonEmptyStringSchema.optional(),
  createdAt: IsoDateTimeSchema,
});

export type BlockedProposalReason = z.infer<typeof BlockedProposalReasonSchema>;
export type BlockedProposalEvent = z.infer<typeof BlockedProposalEventSchema>;
