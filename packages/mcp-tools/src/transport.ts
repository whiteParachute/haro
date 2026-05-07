/**
 * MCP transport layer (FEAT-032 R2 — stdio + JSON-RPC).
 *
 * Two implementations:
 *   - StdioTransport: newline-delimited JSON over process.stdin/stdout. Used
 *     by the per-session subprocess.
 *   - InMemoryTransport: paired send/recv queues used by unit tests so we
 *     don't need a real subprocess to exercise registry → server flow.
 */

import { Readable, Writable } from 'node:stream';

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccessResponse | JsonRpcErrorResponse;

export interface Transport {
  send(message: JsonRpcMessage): Promise<void>;
  receive(): AsyncIterable<JsonRpcMessage>;
  close(): Promise<void>;
}

export class StdioTransport implements Transport {
  private readonly input: Readable;
  private readonly output: Writable;
  private closed = false;

  constructor(input: Readable = process.stdin, output: Writable = process.stdout) {
    this.input = input;
    this.output = output;
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (this.closed) return;
    return new Promise((resolve, reject) => {
      this.output.write(`${JSON.stringify(message)}\n`, (err) => (err ? reject(err) : resolve()));
    });
  }

  async *receive(): AsyncIterable<JsonRpcMessage> {
    let buffer = '';
    for await (const chunk of this.input as AsyncIterable<Buffer | string>) {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.length === 0) continue;
        let parsed: JsonRpcMessage;
        try {
          parsed = JSON.parse(line) as JsonRpcMessage;
        } catch (err) {
          // Codex review SF8: malformed JSON must NOT terminate run(). Emit a
          // JSON-RPC parse-error response (id=null per spec) so the peer can
          // recover, and continue draining frames.
          const errorResponse: JsonRpcErrorResponse = {
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32700,
              message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
            },
          };
          await this.send(errorResponse).catch(() => undefined);
          continue;
        }
        yield parsed;
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

export class InMemoryTransport implements Transport {
  readonly inbox: JsonRpcMessage[] = [];
  readonly outbox: JsonRpcMessage[] = [];
  private resolveNext: ((message: JsonRpcMessage) => void) | null = null;
  private closed = false;
  private readonly waitForOutbound: Array<() => void> = [];

  async send(message: JsonRpcMessage): Promise<void> {
    this.outbox.push(message);
    while (this.waitForOutbound.length > 0) {
      const cb = this.waitForOutbound.shift();
      cb?.();
    }
  }

  push(message: JsonRpcMessage): void {
    if (this.resolveNext) {
      const fn = this.resolveNext;
      this.resolveNext = null;
      fn(message);
    } else {
      this.inbox.push(message);
    }
  }

  async *receive(): AsyncIterable<JsonRpcMessage> {
    while (!this.closed) {
      if (this.inbox.length > 0) {
        const message = this.inbox.shift()!;
        yield message;
        continue;
      }
      const next = await new Promise<JsonRpcMessage | null>((resolve) => {
        this.resolveNext = (m) => resolve(m);
        // also wake on close
        const checkClose = () => {
          if (this.closed) {
            this.resolveNext = null;
            resolve(null);
          }
        };
        if (this.closed) checkClose();
      });
      if (next === null) return;
      yield next;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.resolveNext) {
      const fn = this.resolveNext;
      this.resolveNext = null;
      // Any caller awaiting receive() will get a null and exit the iterator.
      (fn as unknown as (m: JsonRpcMessage | null) => void)(null);
    }
  }

  /** Wait until at least one outbound message is queued, then return all. */
  async drain(): Promise<JsonRpcMessage[]> {
    if (this.outbox.length === 0) {
      await new Promise<void>((resolve) => this.waitForOutbound.push(resolve));
    }
    return this.outbox.splice(0, this.outbox.length);
  }
}

/** Map our internal McpToolError code → JSON-RPC error code (custom range -32600..-32099). */
export function jsonRpcCodeFor(code: string): number {
  switch (code) {
    case 'INVALID_PARAMS':
      return -32602;
    case 'PERMISSION_DENIED':
      return -32001;
    case 'NEEDS_APPROVAL':
      return -32002;
    case 'TARGET_NOT_FOUND':
      return -32003;
    case 'TARGET_DISABLED':
      return -32004;
    case 'TOOL_TIMEOUT':
      return -32005;
    case 'INTERNAL_ERROR':
    default:
      return -32603;
  }
}
