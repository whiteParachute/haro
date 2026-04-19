/** AC1 inner loop — query() pumps mock SDK events through mapSdkEvent. */
import { describe, it, expect } from 'vitest';
import { createClaudeProvider } from '../src/index.js';
import type { SdkEvent, SdkQueryOptions } from '../src/sdk-types.js';

async function* mockSdkEvents(): AsyncGenerator<SdkEvent> {
  yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'he' } };
  yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'llo' } };
  yield {
    type: 'message_stop',
    response_id: 'rsp_42',
    usage: { input_tokens: 3, output_tokens: 5 },
  };
}

describe('ClaudeProvider.query [FEAT-002]', () => {
  it('AC1 pumps SDK events into AgentEvents', async () => {
    const sdkCalls: SdkQueryOptions[] = [];
    const provider = createClaudeProvider(
      {},
      {
        skipEnvGuard: true,
        queryFn: (opts) => {
          sdkCalls.push(opts);
          return mockSdkEvents();
        },
      },
    );
    const events = [];
    for await (const ev of provider.query({ prompt: 'hello?' })) {
      events.push(ev);
    }
    expect(events).toEqual([
      { type: 'text', content: 'he', delta: true },
      { type: 'text', content: 'llo', delta: true },
      {
        type: 'result',
        content: '',
        responseId: 'rsp_42',
        usage: { inputTokens: 3, outputTokens: 5 },
      },
    ]);
    expect(sdkCalls[0]?.prompt).toBe('hello?');
    // Default model falls back to DEFAULT_CLAUDE_MODEL.
    expect(typeof sdkCalls[0]?.model).toBe('string');
  });

  it('AC1 surfaces thrown SDK errors as AgentErrorEvent', async () => {
    const provider = createClaudeProvider(
      {},
      {
        skipEnvGuard: true,
        queryFn: () => {
          throw new Error('fake SDK crash');
        },
      },
    );
    const out = [];
    for await (const ev of provider.query({ prompt: 'x' })) out.push(ev);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'error', retryable: false });
    expect((out[0] as { message: string }).message).toContain('fake SDK crash');
  });

  it('R7 never forwards apiKey to SDK even if passed via providerOptions', async () => {
    const calls: SdkQueryOptions[] = [];
    const provider = createClaudeProvider(
      {},
      {
        skipEnvGuard: true,
        queryFn: (opts) => {
          calls.push(opts);
          return mockSdkEvents();
        },
      },
    );
    const events = [];
    for await (const ev of provider.query({
      prompt: 'x',
      providerOptions: { apiKey: 'sk-leaked', customFlag: true },
    })) {
      events.push(ev);
    }
    expect(calls[0]).toBeDefined();
    expect(calls[0]!.apiKey).toBeUndefined();
    expect(calls[0]!.customFlag).toBe(true);
  });

  it('R2 intersects per-query tools with config allowlist', async () => {
    const calls: SdkQueryOptions[] = [];
    const provider = createClaudeProvider(
      { toolsAllow: ['Read', 'Grep'], toolsDeny: ['Bash'] },
      {
        skipEnvGuard: true,
        queryFn: (opts) => {
          calls.push(opts);
          return mockSdkEvents();
        },
      },
    );
    const out = [];
    for await (const ev of provider.query({
      prompt: 'x',
      tools: ['Read', 'Bash', 'Write'],
    })) {
      out.push(ev);
    }
    expect(calls[0]?.allowedTools).toEqual(['Read']);
    expect(calls[0]?.disallowedTools).toEqual(['Bash']);
  });
});

describe('ClaudeProvider schema [FEAT-002]', () => {
  it('R7/AC3 constructor throws when options include apiKey', () => {
    expect(() =>
      createClaudeProvider({ apiKey: 'sk-xxx' } as never, { skipEnvGuard: true }),
    ).toThrow(/apiKey/);
  });

  it('R7 constructor throws when ANTHROPIC_API_KEY env var is set (codex MUST-FIX)', () => {
    expect(() =>
      createClaudeProvider({}, { readEnv: (n) => (n === 'ANTHROPIC_API_KEY' ? 'sk-fake' : undefined) }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('R2 tools=[] is a deliberate "no tools" override (codex SHOULD-FIX)', async () => {
    const calls: SdkQueryOptions[] = [];
    const provider = createClaudeProvider(
      { toolsAllow: ['Read', 'Grep'] },
      {
        skipEnvGuard: true,
        queryFn: (opts) => {
          calls.push(opts);
          return mockSdkEvents();
        },
      },
    );
    for await (const _ of provider.query({ prompt: 'x', tools: [] })) void _;
    expect(calls[0]?.allowedTools).toEqual([]);
  });
});
