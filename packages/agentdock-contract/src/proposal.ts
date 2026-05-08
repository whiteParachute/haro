import { z } from 'zod';
import { IsoDateTimeSchema, NonEmptyStringSchema, RefSchema } from './primitives.js';

export const ProposalTargetKindSchema = z.enum([
  'prompt',
  'skill',
  'runner-profile',
  'routing-rule',
  'memory',
  'mcp-tool-config',
  'schedule-config',
  'haro-code',
  'agentdock-contract',
]);

export const EvolutionLevelSchema = z.enum(['L0', 'L1', 'L2', 'L3']);

export const ChangeOperationSchema = z.object({
  op: z.enum(['create', 'update', 'delete', 'archive']),
  targetRef: RefSchema,
  contentRef: NonEmptyStringSchema.optional(),
  contentHash: NonEmptyStringSchema.optional(),
  summary: NonEmptyStringSchema,
});

export const TestPlanSchema = z.object({
  requiredCommands: z.array(NonEmptyStringSchema).default([]),
  manualChecks: z.array(NonEmptyStringSchema).default([]),
  regressionRisks: z.array(NonEmptyStringSchema).default([]),
});

export const RollbackPlanSchema = z.object({
  strategy: NonEmptyStringSchema,
  snapshotRequired: z.boolean(),
  rollbackRefs: z.array(RefSchema).default([]),
});

export const EvolutionProposalSchema = z.object({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  status: z.enum(['dry-run', 'proposed', 'validated', 'applied', 'rejected', 'superseded']),
  level: EvolutionLevelSchema,
  targetKind: ProposalTargetKindSchema,
  riskLevel: z.enum(['low', 'medium', 'high']),
  sourceObservationRefs: z.array(RefSchema).min(1),
  changeSet: z.array(ChangeOperationSchema).min(1),
  testPlan: TestPlanSchema,
  rollbackPlan: RollbackPlanSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type ProposalTargetKind = z.infer<typeof ProposalTargetKindSchema>;
export type EvolutionLevel = z.infer<typeof EvolutionLevelSchema>;
export type ChangeOperation = z.infer<typeof ChangeOperationSchema>;
export type TestPlan = z.infer<typeof TestPlanSchema>;
export type RollbackPlan = z.infer<typeof RollbackPlanSchema>;
export type EvolutionProposal = z.infer<typeof EvolutionProposalSchema>;
