/**
 * memory_query tool (historical FEAT-032 compatibility).
 *
 * Sidecar baseline delegates memory ownership to AgentDock. This legacy tool
 * can still read the historical Haro MemoryFabric for old workbench tests.
 */

import { z } from 'zod';
import type { MemoryEntryScope } from '@haro/core';
import { McpToolError } from '../error.js';
import type { ToolDefinition } from '../types.js';

const DimensionSchema = z.enum(['user', 'feedback', 'project', 'reference']);
const ScopeSchema = z.enum(['agent', 'shared', 'platform']);

export const MemoryQueryInputSchema = z.object({
  query: z.string().min(1, 'query must be non-empty'),
  scope: ScopeSchema.optional(),
  dimension: DimensionSchema.optional(),
  limit: z.number().int().positive().max(50).optional(),
});

export type MemoryQueryInput = z.infer<typeof MemoryQueryInputSchema>;

export interface MemoryQueryHitDto {
  id: string;
  scope: string;
  dimension: 'user' | 'feedback' | 'project' | 'reference';
  topic: string;
  excerpt: string;
  score: number;
  sourceRef: string;
}

export interface MemoryQueryOutput {
  hits: MemoryQueryHitDto[];
  total: number;
}

const VALID_DIMENSIONS: ReadonlyArray<MemoryQueryHitDto['dimension']> = [
  'user',
  'feedback',
  'project',
  'reference',
];

export const memoryQueryTool: ToolDefinition<typeof MemoryQueryInputSchema, MemoryQueryOutput> = {
  name: 'memory_query',
  description:
    'Search memory files (aria-memory style). Filters by scope (agent/shared/platform; default agent) and dimension (user/feedback/project/reference). Returns ranked hits without raw file paths.',
  inputSchema: MemoryQueryInputSchema,
  timeoutMs: 5_000,
  async execute(params, ctx): Promise<MemoryQueryOutput> {
    const memory = ctx.deps.memory;
    if (!memory) {
      throw new McpToolError(
        'TARGET_DISABLED',
        'historical Haro MemoryFabric is not configured for this MCP server',
      );
    }
    const limit = Math.min(params.limit ?? 10, 50);
    const scopeFilters = buildScopeFilter(params.scope, ctx.session.agentId);
    const results = memory.searchMemoryFiles(params.query, {
      scopes: scopeFilters,
      ...(params.dimension ? { type: params.dimension } : {}),
      limit,
    });
    const hits: MemoryQueryHitDto[] = results.slice(0, limit).map((result) => ({
      id: result.entry.id,
      scope: result.entry.scope,
      dimension: inferDimension(result.entry.tags),
      topic: result.entry.topic,
      excerpt: truncate(result.entry.summary || result.entry.content, 200),
      score: result.score,
      sourceRef: result.entry.sourceRef,
    }));
    return { hits, total: hits.length };
  },
};

function buildScopeFilter(
  scope: MemoryQueryInput['scope'],
  agentId: string,
): MemoryEntryScope[] | undefined {
  if (!scope) {
    return [`agent:${agentId}` as MemoryEntryScope];
  }
  if (scope === 'agent') return [`agent:${agentId}` as MemoryEntryScope];
  if (scope === 'shared') return ['shared'];
  if (scope === 'platform') return ['platform'];
  return undefined;
}

function inferDimension(tags: readonly string[]): MemoryQueryHitDto['dimension'] {
  for (const tag of tags) {
    if ((VALID_DIMENSIONS as readonly string[]).includes(tag)) {
      return tag as MemoryQueryHitDto['dimension'];
    }
  }
  return 'project';
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
