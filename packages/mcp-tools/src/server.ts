/**
 * MCP server entry — wires Transport ↔ ToolRegistry.
 *
 * Speaks a minimal subset of the MCP JSON-RPC protocol (initialize, tools/list,
 * tools/call). FEAT-032 R2 mandates stdio + JSON-RPC; we keep the server
 * dependency-free by hand-rolling the dispatcher here and isolating the wire
 * format in transport.ts.
 */

import { ToolRegistry } from './registry.js';
import { jsonRpcCodeFor, type Transport, type JsonRpcMessage } from './transport.js';
import { toErrorPayload } from './error.js';
import type {
  SessionContext,
  ToolDependencies,
  ToolDecision,
  ToolErrorPayload,
} from './types.js';

const PROTOCOL_VERSION = '2025-05-01';

export interface ServerOptions {
  transport: Transport;
  registry: ToolRegistry;
  session: SessionContext;
  deps: ToolDependencies;
  logger?: { warn?: (msg: string) => void; error?: (msg: string) => void };
}

export class McpServer {
  private readonly transport: Transport;
  private readonly registry: ToolRegistry;
  private readonly session: SessionContext;
  private readonly deps: ToolDependencies;
  private readonly logger: ServerOptions['logger'];
  private running = false;

  constructor(options: ServerOptions) {
    this.transport = options.transport;
    this.registry = options.registry;
    this.session = options.session;
    this.deps = options.deps;
    this.logger = options.logger;
  }

  async run(): Promise<void> {
    this.running = true;
    try {
      for await (const message of this.transport.receive()) {
        if (!this.running) break;
        await this.handle(message).catch((err) => {
          this.logger?.error?.(
            `mcp-server unhandled error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
          );
        });
      }
    } finally {
      this.running = false;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.transport.close();
  }

  private async handle(message: JsonRpcMessage): Promise<void> {
    if (!('method' in message)) return; // responses go nowhere — server is request-only
    const method = message.method;
    const id = 'id' in message ? message.id : null;
    if (id === null || id === undefined) {
      // notification — not yet used
      return;
    }
    try {
      switch (method) {
        case 'initialize':
          await this.transport.send({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'haro-mcp-tools', version: '0.1.0' },
              session: this.session,
            },
          });
          return;
        case 'tools/list':
          await this.transport.send({
            jsonrpc: '2.0',
            id,
            result: { tools: this.registry.list() },
          });
          return;
        case 'tools/call':
          await this.handleToolCall(id, message.params);
          return;
        default:
          await this.transport.send({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `method not found: ${method}` },
          });
      }
    } catch (err) {
      const payload = toErrorPayload(err);
      await this.transport.send({
        jsonrpc: '2.0',
        id,
        error: errorObject(payload),
      });
    }
  }

  private async handleToolCall(id: number | string, params: unknown): Promise<void> {
    const parsed = parseToolCallParams(params);
    if ('error' in parsed) {
      await this.transport.send({
        jsonrpc: '2.0',
        id,
        error: errorObject(parsed.error),
      });
      return;
    }
    const record = await this.registry.invoke({
      name: parsed.name,
      rawParams: parsed.arguments,
      session: this.session,
      deps: this.deps,
    });
    if (record.result.ok) {
      await this.transport.send({
        jsonrpc: '2.0',
        id,
        result: toolSuccessResult(record.result.value, record.decision, record.latencyMs),
      });
    } else {
      await this.transport.send({
        jsonrpc: '2.0',
        id,
        result: toolErrorResult(record.result.error, record.decision, record.latencyMs),
      });
    }
  }
}

interface McpTextContentBlock {
  type: 'text';
  text: string;
}

interface McpToolCallResult {
  content: McpTextContentBlock[];
  isError: boolean;
  /**
   * Modern MCP clients prefer structuredContent for machine-readable output
   * while content[] stays the protocol-required user-visible fallback.
   */
  structuredContent?: unknown;
  /**
   * Haro-specific execution metadata is retained for existing tests and older
   * consumers. MCP Result passthrough permits additional fields.
   */
  decision: ToolDecision;
  latencyMs: number;
  error?: ToolErrorPayload;
  _meta: {
    haro: {
      decision: ToolDecision;
      latencyMs: number;
      errorCode?: string;
    };
  };
}

function toolSuccessResult(value: unknown, decision: ToolDecision, latencyMs: number): McpToolCallResult {
  return {
    content: [{ type: 'text', text: stringifyToolPayload(value) }],
    structuredContent: normalizeStructuredContent(value),
    isError: false,
    decision,
    latencyMs,
    _meta: { haro: { decision, latencyMs } },
  };
}

function toolErrorResult(error: ToolErrorPayload, decision: ToolDecision, latencyMs: number): McpToolCallResult {
  return {
    content: [{ type: 'text', text: stringifyToolPayload(error) }],
    structuredContent: { error },
    isError: true,
    decision,
    latencyMs,
    error,
    _meta: { haro: { decision, latencyMs, errorCode: error.code } },
  };
}

function stringifyToolPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload === undefined) return '';
  try {
    return JSON.stringify(payload, null, 2) ?? String(payload);
  } catch {
    return String(payload);
  }
}

function normalizeStructuredContent(value: unknown): unknown {
  return value === undefined ? null : value;
}

function parseToolCallParams(
  raw: unknown,
):
  | { name: string; arguments: unknown }
  | { error: ToolErrorPayload } {
  if (typeof raw !== 'object' || raw === null) {
    return {
      error: {
        code: 'INVALID_PARAMS',
        message: 'tools/call params must be an object { name, arguments? }',
        retryable: false,
        remediation: 'Pass { name: string, arguments?: object } per the MCP spec.',
      },
    };
  }
  const obj = raw as { name?: unknown; arguments?: unknown };
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    return {
      error: {
        code: 'INVALID_PARAMS',
        message: 'tools/call params.name must be a non-empty string',
        retryable: false,
        remediation: 'Pass { name: string, arguments?: object } per the MCP spec.',
      },
    };
  }
  return { name: obj.name, arguments: obj.arguments ?? {} };
}

function errorObject(payload: ToolErrorPayload): {
  code: number;
  message: string;
  data: ToolErrorPayload;
} {
  return {
    code: jsonRpcCodeFor(payload.code),
    message: payload.message,
    data: payload,
  };
}
