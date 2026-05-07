/** FEAT-034 — chat store reducer for the structured StreamEvent envelope. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __test__, useChatStore } from '../chat';
import type { ChatMessage } from '../chat';
import type { WebChannelStreamEvent } from '@/api/ws';

const SESSION_ID = 'session-test';

function reset(): void {
  useChatStore.setState({
    sessionId: SESSION_ID,
    status: 'running',
    messages: [],
    toolCalls: [],
    usage: null,
    error: null,
    config: {},
    ws: null,
    channelEnabled: true,
    historyCursor: null,
    historyCursorId: null,
    hasMoreHistory: false,
  });
}

function seedAssistant(): ChatMessage {
  const message: ChatMessage = {
    id: 'a1',
    role: 'assistant',
    content: '',
    events: [],
  };
  useChatStore.setState({ messages: [message] });
  return message;
}

function deliverStream(event: WebChannelStreamEvent): void {
  __test__.handleWebChannelEventForTest(event);
}

beforeEach(() => {
  reset();
});

afterEach(() => {
  reset();
});

describe('FEAT-034 chat store stream envelope', () => {
  it('message_delta extends the latest assistant bubble content', () => {
    seedAssistant();
    deliverStream({
      kind: 'stream',
      sessionId: SESSION_ID,
      event: { kind: 'message_delta', messageId: 'wire-message', delta: 'hello ' },
    });
    expect(useChatStore.getState().messages[0]!.content).toBe('hello ');
    expect(useChatStore.getState().messages[0]!.bucket?.message).toBe('hello ');
  });

  it('tool_call_start adds a pending node to toolCalls', () => {
    deliverStream({
      kind: 'stream',
      sessionId: SESSION_ID,
      event: {
        kind: 'tool_call_start',
        callId: 'c1',
        tool: 'send_message',
        paramsSummary: '{}',
      },
    });
    expect(useChatStore.getState().toolCalls[0]?.status).toBe('pending');
  });

  it('usage_update populates store.usage', () => {
    deliverStream({
      kind: 'stream',
      sessionId: SESSION_ID,
      event: {
        kind: 'usage_update',
        sessionId: SESSION_ID,
        tokens: { input: 10, output: 20, total: 30 },
      },
    });
    expect(useChatStore.getState().usage).toEqual({ input: 10, output: 20, total: 30 });
  });

  it('ignores the matching legacy agent envelope after structured message_done', () => {
    seedAssistant();
    deliverStream({
      kind: 'stream',
      sessionId: SESSION_ID,
      event: { kind: 'message_done', messageId: 'wire-message', finalContent: 'final answer' },
    });
    deliverStream({ kind: 'agent', sessionId: SESSION_ID, delta: 'final answer' });
    expect(useChatStore.getState().messages[0]!.content).toBe('final answer');
  });

  it('keeps legacy agent delta path working when structured events are absent', () => {
    seedAssistant();
    deliverStream({ kind: 'agent', sessionId: SESSION_ID, delta: 'legacy answer' });
    expect(useChatStore.getState().messages[0]!.content).toBe('legacy answer');
  });
});
