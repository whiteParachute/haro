import type { AgentCapabilities } from '@haro/core/provider';
import type { CodexModelInfo } from './list-models.js';

/**
 * FEAT-003 R4 + R8 — capability surface.
 *
 * We DO NOT ship a hardcoded fallback model id (AC6). The `maxContextTokens`
 * field is populated only when `listModels()` returned a context window for
 * the currently-selected model. Otherwise it stays `undefined`, which is the
 * caller's signal to defer length checks (FEAT-005 Runner) until a real
 * model handle is available.
 */
export const CODEX_PROVIDER_CAPABILITIES_BASE: Readonly<Omit<AgentCapabilities, 'maxContextTokens'>> =
  Object.freeze({
    streaming: false,
    toolLoop: false,
    contextCompaction: false,
    contextContinuation: true,
  });

export function buildCodexCapabilities(
  selectedModel: string | undefined,
  models: readonly CodexModelInfo[] | null,
): AgentCapabilities {
  const base: AgentCapabilities = { ...CODEX_PROVIDER_CAPABILITIES_BASE };
  if (!selectedModel || !models) return base;
  const match = models.find((m) => m.id === selectedModel);
  if (match?.maxContextTokens !== undefined) {
    base.maxContextTokens = match.maxContextTokens;
  }
  return base;
}
