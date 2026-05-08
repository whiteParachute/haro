import { z } from 'zod';
import { IsoDateTimeSchema, NonEmptyStringSchema } from './primitives.js';

export const ObservationSourceKindSchema = z.enum([
  'api',
  'event-export',
  'event-stream',
  'filesystem',
  'db-export',
  'logs',
  'fake',
]);

export const ObservationSourceSchema = z.object({
  kind: ObservationSourceKindSchema,
  ref: NonEmptyStringSchema,
  readOnly: z.boolean().default(true),
});

export const AgentDockConnectionSchema = z.object({
  id: NonEmptyStringSchema,
  baseUrl: z.string().url(),
  authRef: NonEmptyStringSchema.optional(),
  capabilityVersion: NonEmptyStringSchema.optional(),
  observationSources: z.array(ObservationSourceSchema).min(1),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type ObservationSourceKind = z.infer<typeof ObservationSourceKindSchema>;
export type ObservationSource = z.infer<typeof ObservationSourceSchema>;
export type AgentDockConnection = z.infer<typeof AgentDockConnectionSchema>;
