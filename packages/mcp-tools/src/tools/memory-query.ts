/**
 * memory_query tool (historical FEAT-032 compatibility).
 *
 * FEAT-081X/F-3 retires the legacy Haro MemoryFabric MCP read surface.
 * The tool remains registered for stable legacy tools/list descriptors, but
 * execution fails closed and does not read Haro-owned MemoryFabric data.
 */

import { z } from 'zod';
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

export const MEMORY_QUERY_RETIRED_MESSAGE =
  'legacy MCP memory_query is retired in FEAT-081X/F-3: legacy Haro MemoryFabric reads are disabled. Haro now preserves only AgentDock self-evolution sidecar proposal/review workflows; No ~/.haro memory data is read, migrated, deleted, or returned by this tool.';

export const memoryQueryTool: ToolDefinition<typeof MemoryQueryInputSchema, MemoryQueryOutput> = {
  name: 'memory_query',
  description:
    'retired legacy MCP memory_query (FEAT-081X/F-3): legacy Haro MemoryFabric reads are disabled. Haro preserves only AgentDock self-evolution sidecar proposal/review workflows; No ~/.haro memory data is read. The tool remains registered for stable legacy tools/list compatibility and fails closed with TARGET_DISABLED.',
  inputSchema: MemoryQueryInputSchema,
  timeoutMs: 5_000,
  async execute(): Promise<MemoryQueryOutput> {
    throw new McpToolError('TARGET_DISABLED', MEMORY_QUERY_RETIRED_MESSAGE);
  },
};
