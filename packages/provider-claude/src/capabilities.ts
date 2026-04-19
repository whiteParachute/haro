import type { AgentCapabilities } from '@haro/core/provider';

/**
 * FEAT-002 R4 — static per-model context table. The spec calls this out
 * explicitly as Phase-0 scope; Phase 2 replaces the literal with the
 * Hermes-style multi-source resolution chain.
 */
export const CLAUDE_MAX_CONTEXT: Readonly<Record<string, number>> = Object.freeze({
  'claude-haiku-4-5': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-opus-4-7': 200_000,
  'claude-opus-4-7[1m]': 1_000_000,
});

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';

export function resolveMaxContextTokens(model: string | undefined): number {
  if (!model) return CLAUDE_MAX_CONTEXT[DEFAULT_CLAUDE_MODEL] ?? 200_000;
  const exact = CLAUDE_MAX_CONTEXT[model];
  if (exact) return exact;
  // Unknown models (future releases) fall back to the Sonnet baseline. Phase
  // 2's dynamic resolver supersedes this heuristic.
  return 200_000;
}

export function buildClaudeCapabilities(model?: string): AgentCapabilities {
  return {
    streaming: true,
    toolLoop: true,
    contextCompaction: true,
    permissionModes: ['plan', 'auto', 'bypass'],
    maxContextTokens: resolveMaxContextTokens(model),
  };
}
