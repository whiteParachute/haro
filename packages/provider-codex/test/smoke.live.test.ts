/**
 * FEAT-003 AC1 / AC2 — live smoke test.
 *
 * Requires `OPENAI_API_KEY` and is gated behind the `@live` pattern in the
 * `test:live` script. The default `pnpm test` run SKIPS this file (see
 * `vitest.config.ts` `exclude`), so it never blocks CI — but a real key
 * holder can verify the round-trip via:
 *
 *   pnpm --filter @haro/provider-codex test:live
 *
 * AC1 → "Write hello world in Python" should come back with code content.
 * AC2 → A second query with `previousResponseId` from the first must show
 *       that the model is resuming the same Codex thread.
 */
import { describe, it, expect } from 'vitest';
import { createCodexProvider } from '../src/index.js';
import type { AgentEvent, AgentResultEvent } from '@haro/core/provider';

const liveOnly = process.env.OPENAI_API_KEY ? describe : describe.skip;

liveOnly('CodexProvider live smoke [FEAT-003 AC1/AC2] @live', () => {
  it('AC1: "Write hello world in Python" returns code content', async () => {
    const provider = createCodexProvider({});
    const events: AgentEvent[] = [];
    for await (const ev of provider.query({
      prompt: 'Write hello world in Python. Only give the code.',
    })) {
      events.push(ev);
    }
    const result = events.find((e): e is AgentResultEvent => e.type === 'result');
    expect(result, 'expected a terminal AgentResultEvent').toBeDefined();
    expect(result?.content.length ?? 0).toBeGreaterThan(0);
    expect(result?.content.toLowerCase()).toMatch(/print|hello/);
  }, 120_000);

  it('AC2: second query resumes via previousResponseId', async () => {
    const provider = createCodexProvider({});
    const first: AgentEvent[] = [];
    for await (const ev of provider.query({
      prompt: 'Remember the number 17. Reply with OK only.',
    })) {
      first.push(ev);
    }
    const firstResult = first.find((e): e is AgentResultEvent => e.type === 'result');
    expect(firstResult?.responseId, 'first turn should surface a responseId').toBeTruthy();

    const second: AgentEvent[] = [];
    const ctx: { sessionId: string; previousResponseId?: string } = { sessionId: 'live' };
    if (firstResult?.responseId) ctx.previousResponseId = firstResult.responseId;
    for await (const ev of provider.query({
      prompt: 'What number did I ask you to remember?',
      sessionContext: ctx,
    })) {
      second.push(ev);
    }
    const secondResult = second.find((e): e is AgentResultEvent => e.type === 'result');
    expect(secondResult?.content ?? '').toMatch(/17/);
  }, 120_000);
});
