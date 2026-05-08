import { z } from 'zod';
import { IsoDateTimeSchema, NonEmptyStringSchema } from './primitives.js';

export const CapabilityFlagSchema = z.object({
  available: z.boolean(),
  version: NonEmptyStringSchema.optional(),
  notes: z.array(NonEmptyStringSchema).default([]),
});

export const AgentDockCapabilitySchema = z.object({
  connectionId: NonEmptyStringSchema,
  probedAt: IsoDateTimeSchema,
  contractVersion: NonEmptyStringSchema,
  mcp: CapabilityFlagSchema,
  scheduler: CapabilityFlagSchema,
  skills: CapabilityFlagSchema,
  eventExport: CapabilityFlagSchema,
  filesystemContract: CapabilityFlagSchema,
});

export type CapabilityFlag = z.infer<typeof CapabilityFlagSchema>;
export type AgentDockCapability = z.infer<typeof AgentDockCapabilitySchema>;
