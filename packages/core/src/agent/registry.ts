import type { AgentConfig } from './types.js';

/**
 * FEAT-004 R4 — in-memory AgentRegistry.
 *
 * Conscious choices:
 *   • `register(cfg)` rejects duplicate ids by throwing — the loader catches
 *     and downgrades to a warn (R5). Throwing keeps the registry's internal
 *     invariant ("ids are unique") visible from the API alone.
 *   • `get(id)` throws when missing; `tryGet(id)` returns undefined. Callers
 *     that already validated existence pay no cost; callers that need to
 *     branch use the explicit `tryGet`.
 *   • `list()` returns frozen snapshots so consumers cannot mutate internal
 *     state by accident.
 */
export class AgentIdConflictError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Agent id '${id}' is already registered`);
    this.name = 'AgentIdConflictError';
    this.id = id;
  }
}

export class AgentNotFoundError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Agent id '${id}' is not registered`);
    this.name = 'AgentNotFoundError';
    this.id = id;
  }
}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentConfig>();

  register(cfg: AgentConfig): void {
    if (this.agents.has(cfg.id)) {
      throw new AgentIdConflictError(cfg.id);
    }
    this.agents.set(cfg.id, freezeConfig(cfg));
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }

  get(id: string): AgentConfig {
    const cfg = this.agents.get(id);
    if (!cfg) throw new AgentNotFoundError(id);
    return cfg;
  }

  tryGet(id: string): AgentConfig | undefined {
    return this.agents.get(id);
  }

  list(): readonly AgentConfig[] {
    return Object.freeze(Array.from(this.agents.values()));
  }

  size(): number {
    return this.agents.size;
  }
}

function freezeConfig(cfg: AgentConfig): AgentConfig {
  return Object.freeze({
    ...cfg,
    tools: cfg.tools ? Object.freeze([...cfg.tools]) : undefined,
  });
}
