import { z } from 'zod';
import { IsoDateTimeSchema, NonEmptyStringSchema, RefSchema } from './primitives.js';

export const FrontierSourceTypeSchema = z.enum([
  'x-post',
  'youtube-video',
  'paper',
  'repo-release',
  'official-doc',
  'blog-post',
  'benchmark-report',
]);

export const FrontierTargetDomainSchema = z.enum([
  'runner',
  'web',
  'message-channel',
  'memory',
  'mcp-tools',
  'scheduler',
  'skills',
  'haro-sidecar',
  'agentdock-kernel',
]);

export const FrontierConfidenceSchema = z.enum(['low', 'medium', 'high']);

export const FrontierSignalStatusSchema = z.enum([
  'active',
  'rejected',
  'superseded',
]);

export const FrontierSignalSchema = z.object({
  id: NonEmptyStringSchema,
  sourceType: FrontierSourceTypeSchema,
  sourceRef: RefSchema,
  title: NonEmptyStringSchema,
  publishedAt: IsoDateTimeSchema.optional(),
  collectedAt: IsoDateTimeSchema,
  summary: NonEmptyStringSchema,
  claims: z.array(NonEmptyStringSchema).default([]),
  targetDomains: z.array(FrontierTargetDomainSchema).min(1),
  confidence: FrontierConfidenceSchema,
  rawRef: RefSchema.optional(),
  status: FrontierSignalStatusSchema,
});

export type FrontierSourceType = z.infer<typeof FrontierSourceTypeSchema>;
export type FrontierTargetDomain = z.infer<typeof FrontierTargetDomainSchema>;
export type FrontierConfidence = z.infer<typeof FrontierConfidenceSchema>;
export type FrontierSignalStatus = z.infer<typeof FrontierSignalStatusSchema>;
export type FrontierSignal = z.infer<typeof FrontierSignalSchema>;
