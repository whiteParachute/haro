/** FEAT-003 R2 / R3 / AC1 / AC2 — query() pumps SDK events; previousResponseId routes to resumeThread. */
import { describe, it, expect, vi } from 'vitest';
import { createCodexProvider } from '../src/index.js';
import type {
  SdkCodex,
  SdkThread,
  SdkThreadEvent,
} from '../src/sdk-types.js';

interface RecordedCall {
  kind: 'startThread' | 'resumeThread';
  threadIdParam?: string;
  options?: unknown;
  prompts: string[];
}

function makeFakeCodex(scriptedEventsByCall: SdkThreadEvent[][]): {
  codex: SdkCodex;
  calls: RecordedCall[];
} {
  let callIndex = 0;
  const calls: RecordedCall[] = [];

  function makeThread(record: RecordedCall): SdkThread {
    const seedId =
      record.kind === 'resumeThread' ? record.threadIdParam ?? null : null;
    let id: string | null = seedId;
    return {
      get id() {
        return id;
      },
      async runStreamed(input: string) {
        record.prompts.push(input);
        const events = scriptedEventsByCall[callIndex++] ?? [];
        async function* gen(): AsyncGenerator<SdkThreadEvent> {
          for (const ev of events) {
            if (ev.type === 'thread.started') id = ev.thread_id;
            yield ev;
          }
        }
        return { events: gen() };
      },
    };
  }

  return {
    calls,
    codex: {
      startThread(options) {
        const record: RecordedCall = { kind: 'startThread', options, prompts: [] };
        calls.push(record);
        return makeThread(record);
      },
      resumeThread(id, options) {
        const record: RecordedCall = {
          kind: 'resumeThread',
          threadIdParam: id,
          options,
          prompts: [],
        };
        calls.push(record);
        return makeThread(record);
      },
    },
  };
}

describe('CodexProvider.query [FEAT-003 R2 / R3]', () => {
  it('AC1: emits text + result with responseId from thread.started', async () => {
    const { codex } = makeFakeCodex([
      [
        { type: 'thread.started', thread_id: 'thr_first' },
        { type: 'turn.started' },
        {
          type: 'item.completed',
          item: { id: 'msg_1', type: 'agent_message', text: 'hello world' },
        },
        {
          type: 'turn.completed',
          usage: { input_tokens: 11, cached_input_tokens: 0, output_tokens: 22 },
        },
      ],
    ]);
    const provider = createCodexProvider(
      {},
      {
        readApiKey: () => 'sk-test',
        codexFactory: () => codex,
      },
    );
    const events = [];
    for await (const ev of provider.query({ prompt: 'hi' })) events.push(ev);
    expect(events).toEqual([
      { type: 'text', content: 'hello world', delta: false },
      {
        type: 'result',
        content: 'hello world',
        responseId: 'thr_first',
        usage: { inputTokens: 11, outputTokens: 22 },
      },
    ]);
  });

  it('AC2: previousResponseId routes through resumeThread + carries id forward', async () => {
    const { codex, calls } = makeFakeCodex([
      [
        { type: 'turn.started' },
        {
          type: 'item.completed',
          item: { id: 'msg_2', type: 'agent_message', text: 'remembered' },
        },
        {
          type: 'turn.completed',
          usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
        },
      ],
    ]);
    const provider = createCodexProvider(
      {},
      {
        readApiKey: () => 'sk-test',
        codexFactory: () => codex,
      },
    );
    const events = [];
    for await (const ev of provider.query({
      prompt: 'next turn',
      sessionContext: { sessionId: 's1', previousResponseId: 'thr_first' },
    })) {
      events.push(ev);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe('resumeThread');
    expect(calls[0]?.threadIdParam).toBe('thr_first');
    const last = events.at(-1);
    expect(last).toMatchObject({ type: 'result', content: 'remembered', responseId: 'thr_first' });
  });

  it('passes the selected model to startThread (R2)', async () => {
    const { codex, calls } = makeFakeCodex([
      [
        { type: 'thread.started', thread_id: 'thr_x' },
        { type: 'turn.started' },
        {
          type: 'item.completed',
          item: { id: 'a', type: 'agent_message', text: 'ok' },
        },
        {
          type: 'turn.completed',
          usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
        },
      ],
    ]);
    const provider = createCodexProvider(
      { defaultModel: 'gpt-5-codex' },
      { readApiKey: () => 'sk-test', codexFactory: () => codex },
    );
    for await (const _ of provider.query({ prompt: 'x' })) void _;
    expect((calls[0]?.options as { model?: string }).model).toBe('gpt-5-codex');
  });

  it('AC1: surfaces SDK throw at runStreamed as AgentErrorEvent', async () => {
    const codex: SdkCodex = {
      startThread() {
        return {
          get id() {
            return null;
          },
          async runStreamed() {
            throw new Error('boom');
          },
        };
      },
      resumeThread() {
        throw new Error('not used');
      },
    };
    const provider = createCodexProvider(
      {},
      { readApiKey: () => 'sk-test', codexFactory: () => codex },
    );
    const events = [];
    for await (const ev of provider.query({ prompt: 'x' })) events.push(ev);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', retryable: false });
  });

  it('AC7: turn.failed with context overflow → context_too_long + hint', async () => {
    const { codex } = makeFakeCodex([
      [
        { type: 'thread.started', thread_id: 'thr_q' },
        { type: 'turn.started' },
        {
          type: 'turn.failed',
          error: { message: 'context length exceeded for model' },
        },
      ],
    ]);
    const provider = createCodexProvider(
      {},
      { readApiKey: () => 'sk-test', codexFactory: () => codex },
    );
    const events = [];
    for await (const ev of provider.query({ prompt: 'x' })) events.push(ev);
    const errEv = events.find((e) => e.type === 'error');
    expect(errEv).toMatchObject({
      type: 'error',
      code: 'context_too_long',
      retryable: false,
      hint: 'save-and-clear',
    });
  });

  it('R5: query without OPENAI_API_KEY surfaces auth-style error', async () => {
    const provider = createCodexProvider(
      {},
      {
        readApiKey: () => undefined,
        // FEAT-029: explicitly stub the codex auth check to "no auth" so this
        // test stays deterministic on machines where the developer is signed
        // in to codex CLI's ChatGPT subscription.
        readCodexAuth: () => ({
          detected: false,
          hasAuth: false,
          authMode: null,
          accountId: null,
          lastRefresh: null,
          authFilePath: '/tmp/no-such-codex/auth.json',
        }),
        codexFactory: vi.fn() as unknown as () => SdkCodex,
      },
    );
    const events = [];
    for await (const ev of provider.query({ prompt: 'x' })) events.push(ev);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', retryable: false });
    expect((events[0] as { message: string }).message).toContain('OPENAI_API_KEY');
  });
});
