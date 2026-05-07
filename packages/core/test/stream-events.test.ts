/** FEAT-034 R1 / G4 / AC7 — StreamEvent protocol & translator coverage. */
import { describe, expect, it } from 'vitest';
import {
  STREAM_EVENT_KINDS,
  agentEventToStream,
  applyStreamEventToBucket,
  emptyBucket,
  isStreamEvent,
  isStreamMessageDelta,
  isStreamMessageDone,
  isStreamThinkingDelta,
  isStreamThinkingDone,
  isStreamToolCallStart,
  isStreamToolCallEnd,
  isStreamToolCallError,
  isStreamHookPre,
  isStreamHookPost,
  isStreamUsageUpdate,
  isStreamSessionStatus,
  isStreamError,
  type StreamEvent,
} from '../src/stream/index.js';

const ALL_GUARDS: Array<(value: unknown) => value is StreamEvent> = [
  isStreamMessageDelta,
  isStreamMessageDone,
  isStreamThinkingDelta,
  isStreamThinkingDone,
  isStreamToolCallStart,
  isStreamToolCallEnd,
  isStreamToolCallError,
  isStreamHookPre,
  isStreamHookPost,
  isStreamUsageUpdate,
  isStreamSessionStatus,
  isStreamError,
];

const FIXTURES: Record<string, StreamEvent> = {
  message_delta: { kind: 'message_delta', messageId: 'm1', delta: 'hi ' },
  message_done: { kind: 'message_done', messageId: 'm1', finalContent: 'hi there' },
  thinking_delta: { kind: 'thinking_delta', messageId: 'm1', delta: 'I think ' },
  thinking_done: { kind: 'thinking_done', messageId: 'm1', finalContent: 'I thought.' },
  tool_call_start: {
    kind: 'tool_call_start',
    callId: 'c1',
    parentCallId: 'p',
    tool: 'send_message',
    paramsSummary: '{"x":1}',
  },
  tool_call_end: {
    kind: 'tool_call_end',
    callId: 'c1',
    status: 'success',
    durationMs: 25,
    resultSummary: 'ok',
  },
  tool_call_error: {
    kind: 'tool_call_error',
    callId: 'c1',
    errorCode: 'TOOL_TIMEOUT',
    message: 'too slow',
    retryable: true,
  },
  hook_pre: { kind: 'hook_pre', callId: 'c1', hook: 'PreToolUse', status: 'allowed' },
  hook_post: { kind: 'hook_post', callId: 'c1', hook: 'PostToolUse', status: 'success' },
  usage_update: {
    kind: 'usage_update',
    sessionId: 's1',
    tokens: { input: 100, output: 200, total: 300 },
  },
  session_status: { kind: 'session_status', sessionId: 's1', status: 'completed' },
  error: { kind: 'error', code: 'X', message: 'boom', recoverable: false },
};

describe('FEAT-034 StreamEvent protocol [AC7]', () => {
  it('exposes exactly the 12 StreamEvent kinds', () => {
    expect(STREAM_EVENT_KINDS).toHaveLength(12);
    expect(new Set(STREAM_EVENT_KINDS).size).toBe(12);
    expect(Object.keys(FIXTURES).sort()).toEqual([...STREAM_EVENT_KINDS].sort());
  });

  it.each(STREAM_EVENT_KINDS)('isStreamEvent recognises %s', (kind) => {
    expect(isStreamEvent(FIXTURES[kind])).toBe(true);
  });

  it('rejects malformed payloads on each kind-specific guard', () => {
    for (const guard of ALL_GUARDS) {
      expect(guard(null)).toBe(false);
      expect(guard({})).toBe(false);
      expect(guard({ kind: 'unknown' })).toBe(false);
      expect(guard('string')).toBe(false);
    }
  });

  it('isStreamMessageDelta is strict about field types', () => {
    expect(isStreamMessageDelta({ kind: 'message_delta', messageId: 1, delta: 'x' })).toBe(false);
    expect(isStreamMessageDelta({ kind: 'message_delta', messageId: 'a', delta: null })).toBe(false);
  });

  it('isStreamUsageUpdate validates nested tokens shape', () => {
    expect(
      isStreamUsageUpdate({
        kind: 'usage_update',
        sessionId: 's',
        tokens: { input: 'x', output: 1, total: 2 },
      }),
    ).toBe(false);
  });

  it('isStreamSessionStatus rejects unknown status values', () => {
    expect(isStreamSessionStatus({ kind: 'session_status', sessionId: 's', status: 'paused' })).toBe(false);
  });

  it('isStreamHookPre rejects unknown status values', () => {
    expect(isStreamHookPre({ kind: 'hook_pre', callId: 'c', hook: 'h', status: 'maybe' })).toBe(false);
  });
});

describe('agentEventToStream translator', () => {
  function makeCtx() {
    return {
      sessionId: 's1',
      messageId: 'm1',
      now: () => 1_700_000_000_000,
      toolStartedAt: new Map<string, number>(),
    };
  }

  it('text delta → message_delta', () => {
    const out = agentEventToStream(
      { type: 'text', content: 'hello', delta: true },
      makeCtx(),
    );
    expect(out).toEqual([{ kind: 'message_delta', messageId: 'm1', delta: 'hello' }]);
  });

  it('text final → message_done', () => {
    const out = agentEventToStream({ type: 'text', content: 'hello world' }, makeCtx());
    expect(out).toEqual([{ kind: 'message_done', messageId: 'm1', finalContent: 'hello world' }]);
  });

  it('tool_call → tool_call_start with summarized params', () => {
    const ctx = makeCtx();
    const out = agentEventToStream(
      {
        type: 'tool_call',
        callId: 'c1',
        toolName: 'send_message',
        toolInput: { channelId: 'web', sessionId: 's', content: 'hi' },
      },
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'tool_call_start', callId: 'c1', tool: 'send_message' });
    expect(ctx.toolStartedAt.get('c1')).toBe(1_700_000_000_000);
  });

  it('tool_result → tool_call_end with durationMs from started cache', () => {
    let nowValue = 1_700_000_000_000;
    const ctx = { ...makeCtx(), now: () => nowValue };
    agentEventToStream(
      { type: 'tool_call', callId: 'c1', toolName: 't', toolInput: {} },
      ctx,
    );
    nowValue = 1_700_000_000_500;
    const out = agentEventToStream(
      { type: 'tool_result', callId: 'c1', result: { ok: true } },
      ctx,
    );
    expect(out[0]).toMatchObject({ kind: 'tool_call_end', callId: 'c1', status: 'success', durationMs: 500 });
    expect(ctx.toolStartedAt.has('c1')).toBe(false);
  });

  it('tool_result with isError → tool_call_end status=error', () => {
    const ctx = makeCtx();
    agentEventToStream({ type: 'tool_call', callId: 'c2', toolName: 't', toolInput: {} }, ctx);
    const out = agentEventToStream({ type: 'tool_result', callId: 'c2', result: 'oops', isError: true }, ctx);
    expect(out[0]).toMatchObject({ kind: 'tool_call_end', callId: 'c2', status: 'error' });
  });

  it('result with usage → usage_update + session_status=completed', () => {
    const out = agentEventToStream(
      { type: 'result', content: 'done', usage: { inputTokens: 10, outputTokens: 20 } },
      makeCtx(),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'usage_update', sessionId: 's1', tokens: { input: 10, output: 20, total: 30 } });
    expect(out[1]).toMatchObject({ kind: 'session_status', sessionId: 's1', status: 'completed' });
  });

  it('error → error + session_status=errored', () => {
    const out = agentEventToStream(
      { type: 'error', code: 'CTX', message: 'long', retryable: false },
      makeCtx(),
    );
    expect(out[0]).toMatchObject({ kind: 'error', code: 'CTX' });
    expect(out[1]).toMatchObject({ kind: 'session_status', sessionId: 's1', status: 'errored' });
  });
});

describe('applyStreamEventToBucket reducer', () => {
  it('appends message_delta to bucket.message but only for matching messageId', () => {
    const base = emptyBucket('m1');
    const next = applyStreamEventToBucket(base, { kind: 'message_delta', messageId: 'm1', delta: 'hi' });
    expect(next.message).toBe('hi');
    const ignored = applyStreamEventToBucket(next, { kind: 'message_delta', messageId: 'other', delta: 'no' });
    expect(ignored.message).toBe('hi');
  });

  it('thinking_done overwrites thinking buffer', () => {
    const base = applyStreamEventToBucket(emptyBucket('m1'), {
      kind: 'thinking_delta',
      messageId: 'm1',
      delta: 'partial ',
    });
    const next = applyStreamEventToBucket(base, {
      kind: 'thinking_done',
      messageId: 'm1',
      finalContent: 'final reasoning',
    });
    expect(next.thinking).toBe('final reasoning');
  });

  it('tool_call_start + tool_call_end thread durationMs onto the same node', () => {
    let next = applyStreamEventToBucket(
      emptyBucket('m1'),
      {
        kind: 'tool_call_start',
        callId: 'c1',
        tool: 'send_message',
        paramsSummary: '{}',
      },
      { now: () => 1 },
    );
    next = applyStreamEventToBucket(next, {
      kind: 'tool_call_end',
      callId: 'c1',
      status: 'success',
      durationMs: 7,
      resultSummary: 'ok',
    });
    expect(next.toolCalls[0]!.status).toBe('success');
    expect(next.toolCalls[0]!.durationMs).toBe(7);
    expect(next.toolCalls[0]!.resultSummary).toBe('ok');
  });

  it('hook events update hookPre / hookPost on the matching tool node', () => {
    let next = applyStreamEventToBucket(emptyBucket('m1'), {
      kind: 'tool_call_start',
      callId: 'c1',
      tool: 'send_message',
      paramsSummary: '{}',
    });
    next = applyStreamEventToBucket(next, {
      kind: 'hook_pre',
      callId: 'c1',
      hook: 'PreToolUse',
      status: 'pending',
    });
    next = applyStreamEventToBucket(next, {
      kind: 'hook_post',
      callId: 'c1',
      hook: 'PostToolUse',
      status: 'success',
    });
    expect(next.toolCalls[0]!.hookPre).toBe('pending');
    expect(next.toolCalls[0]!.hookPost).toBe('success');
  });

  it('session-level events leave the bucket unchanged', () => {
    const base = applyStreamEventToBucket(emptyBucket('m1'), {
      kind: 'message_delta',
      messageId: 'm1',
      delta: 'x',
    });
    const next = applyStreamEventToBucket(base, {
      kind: 'session_status',
      sessionId: 's1',
      status: 'completed',
    });
    expect(next).toEqual(base);
  });
});
