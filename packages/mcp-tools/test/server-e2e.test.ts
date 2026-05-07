import { afterEach, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from './helpers.js';
import { McpServer } from '../src/server.js';
import { InMemoryTransport, type JsonRpcMessage } from '../src/transport.js';

let env: TestEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

async function runServerWith(env: TestEnv, requests: JsonRpcMessage[]): Promise<JsonRpcMessage[]> {
  const transport = new InMemoryTransport();
  for (const req of requests) transport.push(req);
  const registry = env.buildRegistry();
  const server = new McpServer({
    transport,
    registry,
    session: env.buildSession({ channelId: 'fake-im' }),
    deps: env.buildDeps(),
  });
  // Run server, drain responses, then close.
  const runPromise = server.run();
  const responses: JsonRpcMessage[] = [];
  for (let i = 0; i < requests.length; i += 1) {
    const drained = await transport.drain();
    responses.push(...drained);
  }
  await server.stop();
  await runPromise;
  return responses;
}

describe('McpServer E2E [FEAT-032 R2]', () => {
  it('responds to initialize with serverInfo and protocolVersion', async () => {
    const e = (env = setupEnv());
    const responses = await runServerWith(e, [
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
    ]);
    expect(responses).toHaveLength(1);
    const r = responses[0]! as { id: number; result: { serverInfo: { name: string } } };
    expect(r.id).toBe(1);
    expect(r.result.serverInfo.name).toBe('haro-mcp-tools');
  });

  it('lists the four builtin tools via tools/list', async () => {
    const e = (env = setupEnv());
    const responses = await runServerWith(e, [
      { jsonrpc: '2.0', id: 7, method: 'tools/list' },
    ]);
    const r = responses[0]! as { id: number; result: { tools: Array<{ name: string }> } };
    const names = r.result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'memory_query',
      'memory_remember',
      'schedule_task',
      'send_message',
    ]);
  });

  it('routes tools/call to the registry and returns a structured success', async () => {
    const e = (env = setupEnv());
    const responses = await runServerWith(e, [
      {
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: {
          name: 'send_message',
          arguments: {
            channelId: 'fake-im',
            sessionId: 'sess-A',
            content: 'hello via mcp',
          },
        },
      },
    ]);
    const r = responses[0]! as { id: number; result: { isError: boolean; decision: string } };
    expect(r.result.isError).toBe(false);
    expect(r.result.decision).toBe('allowed');
    expect(e.fakeChannel.outbound[0]!.sessionId).toBe('sess-A');
  });

  it('returns isError=true with structured error for cross-channel send', async () => {
    const e = (env = setupEnv());
    const transport = new InMemoryTransport();
    transport.push({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'send_message',
        arguments: { channelId: 'fake-im', sessionId: 'x', content: 'hi' },
      },
    });
    const registry = e.buildRegistry();
    const server = new McpServer({
      transport,
      registry,
      session: e.buildSession({ channelId: 'web' }),
      deps: e.buildDeps(),
    });
    const runPromise = server.run();
    const drained = await transport.drain();
    await server.stop();
    await runPromise;
    const r = drained[0]! as { result: { isError: boolean; decision: string; error: { code: string } } };
    expect(r.result.isError).toBe(true);
    expect(r.result.decision).toBe('needs-approval');
    expect(r.result.error.code).toBe('NEEDS_APPROVAL');
  });

  it('returns method-not-found on unknown JSON-RPC methods', async () => {
    const e = (env = setupEnv());
    const responses = await runServerWith(e, [
      { jsonrpc: '2.0', id: 42, method: 'unknown/method' },
    ]);
    const r = responses[0]! as { error: { code: number } };
    expect(r.error.code).toBe(-32601);
  });
});
