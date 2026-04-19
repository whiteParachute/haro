import type { AgentProvider, ProviderRegistry } from '../provider/index.js';
import type { AgentConfig } from './types.js';

/**
 * FEAT-004 R8 / AC7 — startup-time validator for `defaultProvider` /
 * `defaultModel`.
 *
 * Behaviour:
 *   • An Agent that sets `defaultProvider` MUST resolve to a registered
 *     provider; otherwise `resolveAgentDefaults()` throws.
 *   • An Agent that also sets `defaultModel` MUST find that model id in the
 *     provider's `listModels()` result; otherwise throws.
 *   • `defaultModel` without `defaultProvider` is rejected — the pair needs
 *     a provider scope for the model-id lookup to be meaningful.
 *
 * The error is synchronous & precise because the spec explicitly bans
 * silent downgrade (R8: "启动时抛错并指明缺失项，不静默降级").
 */
export interface ListModelsCapable {
  listModels?: () => Promise<ReadonlyArray<{ id: string }>>;
}

export class AgentConfigResolutionError extends Error {
  readonly agentId: string;
  readonly kind:
    | 'unknown-provider'
    | 'unknown-model'
    | 'model-without-provider'
    | 'missing-provider-registry';
  readonly missing: string;

  constructor(
    agentId: string,
    kind: AgentConfigResolutionError['kind'],
    missing: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'AgentConfigResolutionError';
    this.agentId = agentId;
    this.kind = kind;
    this.missing = missing;
  }
}

export async function resolveAgentDefaults(
  cfg: AgentConfig,
  providerRegistry: ProviderRegistry,
): Promise<void> {
  if (!cfg.defaultProvider) {
    if (cfg.defaultModel) {
      throw new AgentConfigResolutionError(
        cfg.id,
        'model-without-provider',
        cfg.defaultModel,
        `Agent '${cfg.id}' declares defaultModel='${cfg.defaultModel}' without a defaultProvider (FEAT-004 R8)`,
      );
    }
    return;
  }
  const provider = providerRegistry.tryGet(cfg.defaultProvider);
  if (!provider) {
    throw new AgentConfigResolutionError(
      cfg.id,
      'unknown-provider',
      cfg.defaultProvider,
      `Agent '${cfg.id}' references unknown defaultProvider='${cfg.defaultProvider}' (FEAT-004 R8)`,
    );
  }
  if (!cfg.defaultModel) return;

  const modelId = cfg.defaultModel;
  const withModels = provider as AgentProvider & ListModelsCapable;
  if (typeof withModels.listModels !== 'function') {
    throw new AgentConfigResolutionError(
      cfg.id,
      'unknown-model',
      modelId,
      `Agent '${cfg.id}' sets defaultModel='${modelId}' but provider '${cfg.defaultProvider}' does not expose listModels() (FEAT-004 R8)`,
    );
  }
  const models = await withModels.listModels();
  const found = models.some((m) => m.id === modelId);
  if (!found) {
    throw new AgentConfigResolutionError(
      cfg.id,
      'unknown-model',
      modelId,
      `Agent '${cfg.id}' references defaultModel='${modelId}' which is not in provider '${cfg.defaultProvider}' listModels() result (FEAT-004 R8)`,
    );
  }
}
