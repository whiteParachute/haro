/** FEAT-003 R6 / AC3 — healthCheck races listModels against a 5s ceiling. */
import { describe, it, expect, vi } from 'vitest';
import { createCodexProvider } from '../src/index.js';
import type { ModelLister } from '../src/list-models.js';

function lister(behavior: () => Promise<unknown>): ModelLister {
  return {
    async listModels() {
      await behavior();
      return [];
    },
    invalidate() {
      /* noop */
    },
    inspectCache() {
      return null;
    },
  };
}

describe('CodexProvider.healthCheck [FEAT-003 R6]', () => {
  it('returns true when listModels resolves', async () => {
    const provider = createCodexProvider(
      {},
      { readApiKey: () => 'sk', modelLister: lister(async () => undefined) },
    );
    expect(await provider.healthCheck()).toBe(true);
  });

  it('AC3: returns false when listModels rejects', async () => {
    const provider = createCodexProvider(
      {},
      {
        readApiKey: () => 'sk',
        modelLister: lister(async () => {
          throw new Error('401 unauthorized');
        }),
      },
    );
    expect(await provider.healthCheck()).toBe(false);
  });

  it('AC3: returns false within 5s when listModels hangs (timeout race)', async () => {
    vi.useFakeTimers();
    try {
      const provider = createCodexProvider(
        {},
        {
          readApiKey: () => 'sk',
          modelLister: lister(
            () =>
              new Promise(() => {
                /* never resolves */
              }),
          ),
        },
      );
      const promise = provider.healthCheck();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await promise).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
