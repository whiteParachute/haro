import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '../src/json-schema.js';

describe('zodToJsonSchema [FEAT-032 R3]', () => {
  it('converts a primitive object with optional fields', () => {
    const schema = z.object({
      name: z.string().min(1),
      age: z.number().int().optional(),
      tag: z.enum(['a', 'b']),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1 },
        age: { type: 'integer' },
        tag: { type: 'string', enum: ['a', 'b'] },
      },
      required: ['name', 'tag'],
    });
  });

  it('converts arrays and unions', () => {
    const schema = z.object({
      tags: z.array(z.string()),
      content: z.union([z.string(), z.number()]),
    });
    const out = zodToJsonSchema(schema);
    expect(out.properties?.tags).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
    expect(out.properties?.content).toHaveProperty('anyOf');
  });
});
