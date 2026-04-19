/** FEAT-004 R8 / AC7 — defaultProvider/defaultModel existence validator. */
import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from '../src/provider/index.js';
import type { AgentProvider, AgentQueryParams, AgentEvent } from '../src/provider/index.js';
import {
  AgentConfigResolutionError,
  resolveAgentDefaults,
} from '../src/agent/index.js';
import type { AgentConfig } from '../src/agent/index.js';

function fakeProvider(
  id: string,
  models?: readonly string[],
): AgentProvider & { listModels?: () => Promise<{ id: string }[]> } {
  const p: AgentProvider & { listModels?: () => Promise<{ id: string }[]> } = {
    id,
    async *query(_params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
      /* unused in tests */
    },
    capabilities() {
      return { streaming: false, toolLoop: false, contextCompaction: false };
    },
    async healthCheck() {
      return true;
    },
  };
  if (models) {
    p.listModels = async () => models.map((id) => ({ id }));
  }
  return p;
}

const cfg = (over: Partial<AgentConfig>): AgentConfig => ({
  id: 'x',
  name: 'X',
  systemPrompt: 'p',
  ...over,
});

describe('resolveAgentDefaults [FEAT-004 R8]', () => {
  it('no-op when neither defaultProvider nor defaultModel are set', async () => {
    const reg = new ProviderRegistry();
    await expect(resolveAgentDefaults(cfg({}), reg)).resolves.toBeUndefined();
  });

  it('AC7: unknown defaultProvider throws with detail', async () => {
    const reg = new ProviderRegistry();
    reg.register(fakeProvider('codex'));
    await expect(
      resolveAgentDefaults(cfg({ defaultProvider: 'unknown-provider' }), reg),
    ).rejects.toMatchObject({
      name: 'AgentConfigResolutionError',
      kind: 'unknown-provider',
      missing: 'unknown-provider',
    });
  });

  it('AC7: unknown defaultModel throws with detail', async () => {
    const reg = new ProviderRegistry();
    reg.register(fakeProvider('codex', ['gpt-5-codex']));
    await expect(
      resolveAgentDefaults(
        cfg({ defaultProvider: 'codex', defaultModel: 'nonexistent-model' }),
        reg,
      ),
    ).rejects.toMatchObject({
      name: 'AgentConfigResolutionError',
      kind: 'unknown-model',
      missing: 'nonexistent-model',
    });
  });

  it('accepts defaultProvider+defaultModel when both resolve', async () => {
    const reg = new ProviderRegistry();
    reg.register(fakeProvider('codex', ['gpt-5-codex']));
    await expect(
      resolveAgentDefaults(
        cfg({ defaultProvider: 'codex', defaultModel: 'gpt-5-codex' }),
        reg,
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects defaultModel without defaultProvider (pair must be scoped)', async () => {
    const reg = new ProviderRegistry();
    await expect(
      resolveAgentDefaults(cfg({ defaultModel: 'some-model' }), reg),
    ).rejects.toBeInstanceOf(AgentConfigResolutionError);
  });

  it('rejects defaultModel when provider does not expose listModels()', async () => {
    const reg = new ProviderRegistry();
    reg.register(fakeProvider('codex')); // no listModels
    await expect(
      resolveAgentDefaults(
        cfg({ defaultProvider: 'codex', defaultModel: 'x' }),
        reg,
      ),
    ).rejects.toBeInstanceOf(AgentConfigResolutionError);
  });
});
