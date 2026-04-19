/**
 * FEAT-003 AC3 — live auth-failure test.
 *
 * Runs against the real Codex / OpenAI `/models` endpoint but with a
 * deliberately-wrong key. Gated behind `@live` so unit test runs are not
 * required to have any credentials at all. Activate via:
 *
 *   pnpm --filter @haro/provider-codex test:live
 *
 * AC3 contract: `healthCheck()` returns false in under 5 seconds, and
 * `query()` surfaces an `AgentErrorEvent` with `retryable === false`.
 */
import { describe, it, expect } from 'vitest';
import { createCodexProvider } from '../src/index.js';
import type { AgentEvent } from '@haro/core/provider';

const liveOnly = process.env.HARO_LIVE_AUTH_FAILURE === '1' ? describe : describe.skip;

liveOnly('CodexProvider live auth-failure [FEAT-003 AC3] @live', () => {
  it('AC3: bogus key → healthCheck returns false within 5s', async () => {
    const provider = createCodexProvider(
      {},
      { readApiKey: () => 'sk-definitely-not-a-real-key' },
    );
    const start = Date.now();
    const ok = await provider.healthCheck();
    const elapsed = Date.now() - start;
    expect(ok).toBe(false);
    expect(elapsed).toBeLessThan(5_500);
  }, 10_000);

  it('AC3: bogus key → query yields auth-style AgentErrorEvent (retryable=false)', async () => {
    const provider = createCodexProvider(
      {},
      { readApiKey: () => 'sk-definitely-not-a-real-key' },
    );
    const events: AgentEvent[] = [];
    for await (const ev of provider.query({ prompt: 'hello' })) events.push(ev);
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect(err && 'retryable' in err ? err.retryable : true).toBe(false);
  }, 30_000);
});
