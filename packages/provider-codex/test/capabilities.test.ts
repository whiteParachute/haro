/** FEAT-003 R4 / AC4 — capabilities shape + listModels-driven maxContextTokens. */
import { describe, it, expect } from 'vitest';
import type { CodexModelInfo, ModelLister } from '../src/list-models.js';
import {
  CodexProvider,
  CODEX_PROVIDER_CAPABILITIES_BASE,
  buildCodexCapabilities,
  createCodexProvider,
} from '../src/index.js';

function makeStubLister(models: readonly CodexModelInfo[] | null): ModelLister {
  let cache = models ? { fetchedAt: 0, models } : null;
  return {
    async listModels() {
      return cache?.models ?? [];
    },
    invalidate() {
      cache = null;
    },
    inspectCache() {
      return cache;
    },
  };
}

describe('CodexProvider.capabilities [FEAT-003 R4]', () => {
  it('exposes the static base shape', () => {
    expect(CODEX_PROVIDER_CAPABILITIES_BASE).toMatchObject({
      streaming: false,
      toolLoop: false,
      contextCompaction: false,
      contextContinuation: true,
    });
  });

  it('AC4: maxContextTokens stays undefined when listModels has not run', () => {
    const provider = createCodexProvider(
      { defaultModel: 'gpt-5-codex' },
      {
        readApiKey: () => 'sk-test',
        modelLister: makeStubLister(null),
      },
    );
    expect(provider.capabilities().maxContextTokens).toBeUndefined();
  });

  it('AC4: maxContextTokens comes from the cached listModels entry', async () => {
    const lister = makeStubLister([
      { id: 'gpt-5-codex', maxContextTokens: 256_000 },
    ]);
    // Fill the cache so capabilities() can synchronously consult it.
    await lister.listModels();
    const provider = new CodexProvider(
      { defaultModel: 'gpt-5-codex' },
      {
        readApiKey: () => 'sk-test',
        modelLister: lister,
      },
    );
    const caps = provider.capabilities();
    expect(caps.maxContextTokens).toBe(256_000);
    expect(caps.streaming).toBe(false);
    expect(caps.toolLoop).toBe(false);
    expect(caps.contextContinuation).toBe(true);
  });

  it('buildCodexCapabilities returns base shape when no model selected', () => {
    expect(buildCodexCapabilities(undefined, [])).toEqual({
      streaming: false,
      toolLoop: false,
      contextCompaction: false,
      contextContinuation: true,
    });
  });
});
