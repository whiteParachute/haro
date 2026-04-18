/**
 * Haro Provider implementations live here. Phase 0 scaffold ships with zero
 * providers registered; concrete Claude / Codex adapters arrive in FEAT-002
 * and FEAT-003 (see roadmap/phases.md). The package is published as an empty
 * namespace so future work can land without reshaping the workspace.
 */

export interface ProviderPlaceholder {
  readonly kind: 'placeholder';
}

export const providerPlaceholder: ProviderPlaceholder = { kind: 'placeholder' };
