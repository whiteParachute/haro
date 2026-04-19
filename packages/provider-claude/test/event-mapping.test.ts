/** R3/AC1 — SDK event stream is translated into Haro AgentEvents. */
import { describe, it, expect } from 'vitest';
import { mapSdkEvent, createSdkEventMapper } from '../src/event-mapping.js';

describe('mapSdkEvent [FEAT-002]', () => {
  it('R3 maps content_block_delta(text_delta) to AgentTextEvent (delta=true)', () => {
    const mapped = mapSdkEvent({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'hello' },
    });
    expect(mapped).toEqual({ type: 'text', content: 'hello', delta: true });
  });

  it('R3 emits AgentToolCallEvent at content_block_stop with input_json_delta accumulated', () => {
    const mapper = createSdkEventMapper();
    expect(mapper.push({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call_1', name: 'Read', input: {} },
    })).toEqual([]);
    expect(mapper.push({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"file_path":"/tmp/foo"}' },
    })).toEqual([]);
    const stopped = mapper.push({ type: 'content_block_stop', index: 0 });
    expect(stopped).toEqual([
      {
        type: 'tool_call',
        callId: 'call_1',
        toolName: 'Read',
        toolInput: { file_path: '/tmp/foo' },
      },
    ]);
  });

  it('R3 flush() emits buffered tool_use when stream ends abruptly', () => {
    const mapper = createSdkEventMapper();
    mapper.push({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call_9', name: 'Bash', input: { cmd: 'ls' } },
    });
    expect(mapper.flush()).toEqual([
      {
        type: 'tool_call',
        callId: 'call_9',
        toolName: 'Bash',
        toolInput: { cmd: 'ls' },
      },
    ]);
  });

  it('R3 maps tool_result to AgentToolResultEvent preserving isError', () => {
    const mapped = mapSdkEvent({
      type: 'tool_result',
      tool_use_id: 'call_1',
      content: 'ok',
    });
    expect(mapped).toEqual({ type: 'tool_result', callId: 'call_1', result: 'ok' });

    const errMapped = mapSdkEvent({
      type: 'tool_result',
      tool_use_id: 'call_2',
      content: 'boom',
      is_error: true,
    });
    expect(errMapped).toEqual({
      type: 'tool_result',
      callId: 'call_2',
      result: 'boom',
      isError: true,
    });
  });

  it('R3 maps message_stop to AgentResultEvent with usage', () => {
    const mapped = mapSdkEvent({
      type: 'message_stop',
      response_id: 'rsp_1',
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    expect(mapped).toEqual({
      type: 'result',
      content: '',
      responseId: 'rsp_1',
      usage: { inputTokens: 10, outputTokens: 20 },
    });
  });

  it('R3 maps SDK-native result event (subtype=success, result=<text>) to AgentResultEvent.content', () => {
    const mapped = mapSdkEvent({
      type: 'result',
      subtype: 'success',
      result: 'pong',
      session_id: 'sess_1',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    expect(mapped).toMatchObject({ type: 'result', content: 'pong' });
  });

  it('R3 routes is_error result events through AgentErrorEvent, not empty AgentResultEvent', () => {
    const mapped = mapSdkEvent({
      type: 'result',
      is_error: true,
      errors: ['server failure', 'retry advised'],
    });
    expect(mapped).toMatchObject({ type: 'error', retryable: false });
    expect((mapped as { message: string }).message).toContain('server failure');
  });

  it('R3 maps error with retryable classification', () => {
    const mapped = mapSdkEvent({
      type: 'error',
      error: { type: 'overloaded_error', message: 'slow down' },
    });
    expect(mapped).toEqual({
      type: 'error',
      code: 'overloaded_error',
      message: 'slow down',
      retryable: true,
    });
  });

  it('R3 classifies unknown error codes as non-retryable', () => {
    const mapped = mapSdkEvent({
      type: 'error',
      error: { type: 'invalid_request', message: 'bad' },
    });
    expect(mapped).toEqual({
      type: 'error',
      code: 'invalid_request',
      message: 'bad',
      retryable: false,
    });
  });

  it('R3 ignores unknown event types (forward-compat)', () => {
    expect(mapSdkEvent({ type: 'message_start' } as never)).toBeUndefined();
    expect(mapSdkEvent({ type: 'unknown_future_event' } as never)).toBeUndefined();
  });
});
