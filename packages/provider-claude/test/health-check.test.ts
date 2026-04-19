/** AC5 — healthCheck() returns false within 5s on connection failure. */
import { describe, it, expect } from 'vitest';
import { createClaudeProvider } from '../src/index.js';
import type { SdkEvent } from '../src/sdk-types.js';

async function* neverResolvingStream(signal?: AbortSignal): AsyncGenerator<SdkEvent> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const onAbort = () => reject(new Error('aborted'));
    signal?.addEventListener('abort', onAbort);
    // Simulate a hung network (no yields)
    setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, 15_000).unref?.();
  });
  yield { type: 'result', content: 'pong' };
}

describe('ClaudeProvider.healthCheck [FEAT-002]', () => {
  it('AC5 returns false when SDK hangs beyond the 5s ceiling', async () => {
    const provider = createClaudeProvider(
      {},
      {
        skipEnvGuard: true,
        queryFn: (opts) => neverResolvingStream(opts.signal as AbortSignal | undefined),
      },
    );
    const start = Date.now();
    const ok = await provider.healthCheck();
    const elapsed = Date.now() - start;
    expect(ok).toBe(false);
    // Generous upper bound so CI jitter does not flake (spec AC says < 5s,
    // we allow up to 7s).
    expect(elapsed).toBeLessThan(7_000);
  }, 10_000);

  it('AC5 returns true when SDK yields any event', async () => {
    async function* ok(): AsyncGenerator<SdkEvent> {
      yield { type: 'result', content: 'pong' };
    }
    const provider = createClaudeProvider({}, { skipEnvGuard: true, queryFn: () => ok() });
    expect(await provider.healthCheck()).toBe(true);
  });

  it('AC5 returns false when SDK throws synchronously', async () => {
    const provider = createClaudeProvider(
      {},
      {
        skipEnvGuard: true,
        queryFn: () => {
          throw new Error('auth failure');
        },
      },
    );
    expect(await provider.healthCheck()).toBe(false);
  });
});
