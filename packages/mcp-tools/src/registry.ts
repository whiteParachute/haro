/**
 * Tool registry (FEAT-032 R6.1 / D2).
 *
 * Every registered tool MUST declare a positive integer `timeoutMs`. The
 * registry rejects any descriptor that omits / clamps to ≤ 0; this keeps tool
 * authors honest with the spec's "no implicit defaults" rule.
 *
 * `invoke` is the single entry point used by the MCP server: it sequences
 * permission evaluation → schema parse → execute → timeout race → audit so
 * every code path records a row in tool_invocation_log.
 */

import { ZodError, type ZodTypeAny } from 'zod';
import { McpToolError } from './error.js';
import { evaluatePermission, type PermissionEvaluator } from './permission.js';
import { ToolInvocationAuditWriter } from './audit.js';
import { zodToJsonSchema } from './json-schema.js';
import type {
  SessionContext,
  ToolDecision,
  ToolDefinition,
  ToolDependencies,
  ToolDescriptor,
  ToolErrorCode,
  ToolErrorPayload,
  ToolExecutionContext,
  ToolResult,
  ToolResultStatus,
} from './types.js';

export interface ToolInvocationRecord<T = unknown> {
  decision: ToolDecision;
  result: ToolResult<T>;
  latencyMs: number;
}

export interface RegistryOptions {
  audit: ToolInvocationAuditWriter;
  permissionEvaluator?: PermissionEvaluator;
  now?: () => Date;
}

type AnyToolDefinition = ToolDefinition<ZodTypeAny, unknown>;

export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();
  private readonly audit: ToolInvocationAuditWriter;
  private readonly permission: PermissionEvaluator;
  private readonly now: () => Date;

  constructor(options: RegistryOptions) {
    this.audit = options.audit;
    this.permission = options.permissionEvaluator ?? evaluatePermission;
    this.now = options.now ?? (() => new Date());
  }

  register<TInput extends ZodTypeAny, TOutput>(
    def: ToolDefinition<TInput, TOutput>,
  ): void {
    if (!def.name || !/^[a-z][a-z0-9_]*$/.test(def.name)) {
      throw new Error(
        `ToolRegistry.register: tool name must match /^[a-z][a-z0-9_]*$/ (got '${def.name}')`,
      );
    }
    if (this.tools.has(def.name)) {
      throw new Error(`ToolRegistry.register: duplicate tool '${def.name}'`);
    }
    if (typeof def.timeoutMs !== 'number' || !Number.isFinite(def.timeoutMs) || def.timeoutMs <= 0) {
      throw new Error(
        `ToolRegistry.register: tool '${def.name}' must declare a positive timeoutMs (FEAT-032 D2)`,
      );
    }
    this.tools.set(def.name, def as AnyToolDefinition);
  }

  list(): ToolDescriptor[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema),
      timeoutMs: tool.timeoutMs,
    }));
  }

  get(name: string): AnyToolDefinition | undefined {
    return this.tools.get(name);
  }

  async invoke<T = unknown>(input: {
    name: string;
    rawParams: unknown;
    session: SessionContext;
    deps: ToolDependencies;
  }): Promise<ToolInvocationRecord<T>> {
    const tool = this.tools.get(input.name);
    const startedAt = this.now().getTime();
    if (!tool) {
      const err = new McpToolError(
        'TARGET_NOT_FOUND',
        `tool '${input.name}' is not registered`,
      );
      const record: ToolInvocationRecord<T> = {
        decision: 'denied',
        result: { ok: false, error: err.toPayload() },
        latencyMs: 0,
      };
      this.audit.append({
        sessionId: input.session.sessionId,
        agentId: input.session.agentId,
        toolName: input.name,
        params: input.rawParams,
        decision: 'denied',
        resultStatus: 'error',
        latencyMs: 0,
        errorCode: err.code,
      });
      return record;
    }

    // Schema-validate first so malformed params surface as INVALID_PARAMS
    // rather than NEEDS_APPROVAL (which would pollute the approval queue
    // with garbage requests). This keeps the audit decision honest:
    //   parse fails  → decision=allowed (the gate hasn't run) + INVALID_PARAMS
    //   permission denies → decision=denied + PERMISSION_DENIED
    //   permission approves → decision=needs-approval + NEEDS_APPROVAL
    let parsed: unknown;
    try {
      parsed = (tool.inputSchema as ZodTypeAny).parse(input.rawParams);
    } catch (err) {
      const message = err instanceof ZodError ? formatZodError(err) : err instanceof Error ? err.message : String(err);
      const tooErr = new McpToolError('INVALID_PARAMS', message);
      this.audit.append({
        sessionId: input.session.sessionId,
        agentId: input.session.agentId,
        toolName: tool.name,
        params: input.rawParams,
        decision: 'allowed',
        resultStatus: 'error',
        latencyMs: this.now().getTime() - startedAt,
        errorCode: tooErr.code,
      });
      return {
        decision: 'allowed',
        result: { ok: false, error: tooErr.toPayload() },
        latencyMs: this.now().getTime() - startedAt,
      };
    }

    const permission = this.permission({
      toolName: tool.name,
      params: parsed,
      session: input.session,
      deps: input.deps,
    });
    if (permission.decision === 'denied') {
      const err = new McpToolError(
        'PERMISSION_DENIED',
        permission.reason ?? `tool '${tool.name}' denied by policy`,
      );
      this.audit.append({
        sessionId: input.session.sessionId,
        agentId: input.session.agentId,
        toolName: tool.name,
        params: input.rawParams,
        decision: 'denied',
        resultStatus: 'error',
        latencyMs: 0,
        errorCode: err.code,
      });
      return {
        decision: 'denied',
        result: { ok: false, error: err.toPayload() },
        latencyMs: 0,
      };
    }
    if (permission.decision === 'needs-approval') {
      const err = new McpToolError(
        'NEEDS_APPROVAL',
        permission.reason ?? `tool '${tool.name}' requires approval`,
      );
      this.audit.append({
        sessionId: input.session.sessionId,
        agentId: input.session.agentId,
        toolName: tool.name,
        params: input.rawParams,
        decision: 'needs-approval',
        resultStatus: 'pending',
        latencyMs: 0,
        errorCode: err.code,
      });
      return {
        decision: 'needs-approval',
        result: { ok: false, error: err.toPayload() },
        latencyMs: 0,
      };
    }

    const abortController = new AbortController();
    const ctx: ToolExecutionContext = {
      session: input.session,
      deps: input.deps,
      now: this.now,
      signal: abortController.signal,
    };
    let resultStatus: ToolResultStatus = 'success';
    let errorCode: ToolErrorCode | null = null;
    let result: ToolResult<T>;
    try {
      const value = (await runWithTimeout(
        () => tool.execute(parsed, ctx),
        tool.timeoutMs,
        abortController,
      )) as T;
      result = { ok: true, value };
    } catch (err) {
      resultStatus = 'error';
      const payload = toPayloadFromError(err);
      errorCode = payload.code;
      result = { ok: false, error: payload };
    }
    const latencyMs = this.now().getTime() - startedAt;
    this.audit.append({
      sessionId: input.session.sessionId,
      agentId: input.session.agentId,
      toolName: tool.name,
      params: input.rawParams,
      decision: 'allowed',
      resultStatus,
      latencyMs,
      errorCode,
    });
    return { decision: 'allowed', result, latencyMs };
  }
}

async function runWithTimeout<T>(
  fn: () => Promise<T> | T,
  timeoutMs: number,
  abortController: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const work = Promise.resolve().then(fn);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Best-effort cancellation: well-behaved tools that thread the
        // ctx.signal through downstream calls will stop; tools that ignore
        // it finish in the background but the caller already saw the error.
        abortController.abort();
        reject(new McpToolError('TOOL_TIMEOUT', `tool exceeded ${timeoutMs}ms timeout`));
      }, timeoutMs);
    });
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toPayloadFromError(err: unknown): ToolErrorPayload {
  if (err instanceof McpToolError) return err.toPayload();
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: 'INTERNAL_ERROR',
    message,
    retryable: true,
    remediation: 'Inspect server logs for details and retry.',
  };
}

function formatZodError(err: ZodError): string {
  return err.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}
