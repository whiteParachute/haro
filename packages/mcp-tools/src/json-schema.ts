/**
 * Minimal Zod → JSON Schema converter (FEAT-032 R3).
 *
 * Covers exactly the constructs used by the four builtin tools — string,
 * number, boolean, literal, enum, array, object, optional, union, default,
 * record. We intentionally avoid pulling in `zod-to-json-schema` to keep the
 * dependency surface small (the spec forbids new heavy deps).
 */

import { z, ZodTypeAny } from 'zod';

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  enum?: unknown[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: unknown;
  const?: unknown;
}

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  return convert(schema);
}

function convert(schema: ZodTypeAny): JsonSchema {
  if (schema instanceof z.ZodOptional) {
    return convert(schema._def.innerType);
  }
  if (schema instanceof z.ZodNullable) {
    const inner = convert(schema._def.innerType);
    inner.type = arrayifyType(inner.type, 'null');
    return inner;
  }
  if (schema instanceof z.ZodDefault) {
    const inner = convert(schema._def.innerType);
    inner.default = schema._def.defaultValue();
    return inner;
  }
  if (schema instanceof z.ZodString) {
    const out: JsonSchema = { type: 'string' };
    for (const check of schema._def.checks ?? []) {
      if (check.kind === 'min') out.minLength = check.value;
      if (check.kind === 'max') out.maxLength = check.value;
      if (check.kind === 'regex') out.pattern = check.regex.source;
    }
    return out;
  }
  if (schema instanceof z.ZodNumber) {
    const out: JsonSchema = { type: 'number' };
    for (const check of schema._def.checks ?? []) {
      if (check.kind === 'int') out.type = 'integer';
      if (check.kind === 'min') out.minimum = check.value;
      if (check.kind === 'max') out.maximum = check.value;
    }
    return out;
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean' };
  }
  if (schema instanceof z.ZodLiteral) {
    return { const: schema._def.value };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: [...schema._def.values] };
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: convert(schema._def.type),
    };
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema._def.shape() as Record<string, ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convert(value);
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
    const out: JsonSchema = {
      type: 'object',
      properties,
      additionalProperties: false,
    };
    if (required.length > 0) out.required = required;
    return out;
  }
  if (schema instanceof z.ZodUnion) {
    return { anyOf: schema._def.options.map(convert) };
  }
  if (schema instanceof z.ZodRecord) {
    return {
      type: 'object',
      additionalProperties: convert(schema._def.valueType),
    };
  }
  if (schema instanceof z.ZodAny || schema instanceof z.ZodUnknown) {
    return {};
  }
  // Fallback: emit a permissive empty schema rather than fail loudly.
  return {};
}

function arrayifyType(type: JsonSchema['type'], extra: string): string[] {
  if (Array.isArray(type)) return [...type, extra];
  if (typeof type === 'string') return [type, extra];
  return [extra];
}
