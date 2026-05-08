import { z } from 'zod';

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const NonEmptyStringSchema = z.string().min(1);

export const JsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    JsonPrimitiveSchema,
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

export const RefSchema = z.object({
  id: NonEmptyStringSchema,
  kind: NonEmptyStringSchema,
  uri: NonEmptyStringSchema.optional(),
});

export type Ref = z.infer<typeof RefSchema>;
