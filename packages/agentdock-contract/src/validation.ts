import { z } from 'zod';
import { IsoDateTimeSchema, NonEmptyStringSchema, RefSchema } from './primitives.js';

export const ValidationReportSchema = z.object({
  id: NonEmptyStringSchema,
  proposalId: NonEmptyStringSchema,
  riskVerdict: z.enum(['low', 'medium', 'high', 'blocked']),
  requiredTests: z.array(NonEmptyStringSchema).default([]),
  rollbackReady: z.boolean(),
  applyEligible: z.boolean(),
  blockingReasons: z.array(NonEmptyStringSchema).default([]),
  evidenceRefs: z.array(RefSchema).default([]),
  createdAt: IsoDateTimeSchema,
}).superRefine((report, ctx) => {
  if (report.applyEligible && !report.rollbackReady) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['applyEligible'],
      message: 'applyEligible requires rollbackReady=true',
    });
  }

  if (report.applyEligible && report.riskVerdict === 'blocked') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['riskVerdict'],
      message: 'blocked validation cannot be applyEligible',
    });
  }
});

export type ValidationReport = z.infer<typeof ValidationReportSchema>;
