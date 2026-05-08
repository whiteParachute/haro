/**
 * memory_remember tool (historical FEAT-032 compatibility).
 *
 * Sidecar baseline delegates memory ownership to AgentDock. This legacy tool
 * can still write to the historical Haro MemoryFabric for old workbench tests,
 * but it no longer registers memory as a Haro EvolutionAsset kind.
 */

import { z } from 'zod';
import type { MemoryEntryScope } from '@haro/core';
import { McpToolError } from '../error.js';
import type { ToolDefinition } from '../types.js';

const DimensionSchema = z.enum(['user', 'feedback', 'project', 'reference']);
const ScopeSchema = z.enum(['agent', 'shared', 'platform']);

export const MemoryRememberInputSchema = z.object({
  content: z.string().min(1, 'content must be non-empty'),
  scope: ScopeSchema,
  dimension: DimensionSchema.optional(),
  topic: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  sourceRef: z.string().min(1).optional(),
});

export type MemoryRememberInput = z.infer<typeof MemoryRememberInputSchema>;

export interface MemoryRememberOutput {
  entryId: string;
  scope: string;
  dimension: 'user' | 'feedback' | 'project' | 'reference';
  /** Did the persisted entry's tags include the input dimension? AC3 verifier. */
  dimensionPersisted: boolean;
  assetEventId?: string;
}

export const memoryRememberTool: ToolDefinition<
  typeof MemoryRememberInputSchema,
  MemoryRememberOutput
> = {
  name: 'memory_remember',
  description:
    'Persist a memory entry (aria-memory style). Scope must be agent / shared / platform. Dimension (user / feedback / project / reference) is optional; if omitted the fabric infers per aria-memory rules. Shared/platform writes require operator approval (write-shared).',
  inputSchema: MemoryRememberInputSchema,
  timeoutMs: 5_000,
  async execute(params, ctx): Promise<MemoryRememberOutput> {
    const dimension = params.dimension;
    const scope = resolveScope(params.scope, ctx.session.agentId);
    const topic = params.topic ?? deriveTopic(params.content);
    const sourceRef = params.sourceRef ?? `mcp:memory_remember:${ctx.session.sessionId}`;
    // Only stamp the dimension tag when the caller supplied one. Otherwise we
    // leave the fabric's aria-memory inference to populate it (D4) — adding
    // a default 'project' tag here would silently mis-classify entries.
    const tags = uniqueTags([
      'mcp',
      'memory_remember',
      ...(dimension ? [dimension] : []),
    ]);
    let entry;
    try {
      entry = await ctx.deps.memory.writeEntry({
        layer: 'persistent',
        scope,
        ...(scope.startsWith('agent:') ? { agentId: ctx.session.agentId } : {}),
        topic,
        ...(params.summary ? { summary: params.summary } : {}),
        content: params.content,
        sourceRef,
        tags,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new McpToolError('INTERNAL_ERROR', `memory.writeEntry failed: ${message}`);
    }
    const persistedDimension = inferDimensionFromTags(entry.tags);
    return {
      entryId: entry.id,
      scope: entry.scope,
      dimension: persistedDimension,
      dimensionPersisted: dimension ? entry.tags.includes(dimension) : false,
    };
  },
};

function inferDimensionFromTags(
  tags: readonly string[],
): MemoryRememberOutput['dimension'] {
  for (const tag of tags) {
    if (tag === 'user' || tag === 'feedback' || tag === 'project' || tag === 'reference') {
      return tag;
    }
  }
  return 'project';
}

function resolveScope(scope: 'agent' | 'shared' | 'platform', agentId: string): MemoryEntryScope {
  if (scope === 'agent') return `agent:${agentId}` as MemoryEntryScope;
  return scope as 'shared' | 'platform';
}

function uniqueTags(tags: readonly string[]): string[] {
  return Array.from(new Set(tags.filter((tag) => tag.length > 0)));
}

function deriveTopic(content: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return 'untitled';
  return firstLine.slice(0, 80);
}
