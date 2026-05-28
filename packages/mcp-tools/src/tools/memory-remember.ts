/**
 * memory_remember tool (historical FEAT-032 compatibility, retired by FEAT-081X/F-2).
 *
 * Haro no longer owns durable memory writes. The legacy MCP tool remains
 * registered for compatibility/tools-list stability, but execution fails
 * closed and points callers to AgentDock memory / aria-memory-vault.
 */

import { z } from 'zod';
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
}

export const MEMORY_REMEMBER_RETIRED_MESSAGE =
  'memory_remember has been retired in FEAT-081X/F-2; AgentDock memory / aria-memory-vault owns durable memory writes. Haro keeps only self-evolution sidecar workflows and historical read-only memory access.';

export const memoryRememberTool: ToolDefinition<
  typeof MemoryRememberInputSchema,
  MemoryRememberOutput
> = {
  name: 'memory_remember',
  description:
    'retired in FEAT-081X/F-2: Haro-owned memory writes are disabled. Use AgentDock memory / aria-memory-vault for durable memory writes; this legacy MCP tool remains registered only for fail-closed compatibility.',
  inputSchema: MemoryRememberInputSchema,
  timeoutMs: 5_000,
  async execute(_params, _ctx): Promise<MemoryRememberOutput> {
    throw new McpToolError('TARGET_DISABLED', MEMORY_REMEMBER_RETIRED_MESSAGE);
  },
};
