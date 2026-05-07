import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { setupEnv, type TestEnv } from './helpers.js';
import { ToolRegistry } from '../src/registry.js';
import type { PermissionEvaluator } from '../src/permission.js';
import type { ToolDefinition } from '../src/types.js';

let env: TestEnv | null = null;

afterEach(() => {
  env?.cleanup();
  env = null;
});

const allowAll: PermissionEvaluator = () => ({ decision: 'allowed' });

function bare(): TestEnv {
  env = setupEnv();
  return env;
}

function newRegistry(e: TestEnv): ToolRegistry {
  return new ToolRegistry({ audit: e.audit, permissionEvaluator: allowAll });
}

const happyTool: ToolDefinition<typeof BareSchema, { ok: true }> = {
  name: 'happy_tool',
  description: 'always ok',
  inputSchema: z.object({ msg: z.string().min(1) }),
  timeoutMs: 1_000,
  async execute() {
    return { ok: true };
  },
};
const BareSchema = z.object({ msg: z.string().min(1) });

describe('ToolRegistry [FEAT-032 R6.1 / D2]', () => {
  it('rejects tool registration without a positive timeoutMs', () => {
    const e = bare();
    const registry = newRegistry(e);
    const broken = { ...happyTool, timeoutMs: 0 };
    expect(() => registry.register(broken as never)).toThrow(/positive timeoutMs/);
  });

  it('rejects bad tool names', () => {
    const e = bare();
    const registry = newRegistry(e);
    expect(() => registry.register({ ...happyTool, name: 'BadName' } as never)).toThrow(/tool name must match/);
  });

  it('rejects duplicate registration', () => {
    const e = bare();
    const registry = newRegistry(e);
    registry.register(happyTool);
    expect(() => registry.register(happyTool)).toThrow(/duplicate/);
  });

  it('list() emits each tool with timeoutMs and a JSON-Schema-like inputSchema', () => {
    const e = bare();
    const registry = newRegistry(e);
    registry.register(happyTool);
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('happy_tool');
    expect(list[0]!.timeoutMs).toBe(1_000);
    expect(list[0]!.inputSchema).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          msg: expect.objectContaining({ type: 'string', minLength: 1 }),
        }),
        required: ['msg'],
      }),
    );
  });

  it('invoke() audits a successful call with decision=allowed', async () => {
    const e = bare();
    const registry = newRegistry(e);
    registry.register(happyTool);
    const out = await registry.invoke({
      name: 'happy_tool',
      rawParams: { msg: 'hi' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    expect(out.decision).toBe('allowed');
    expect(out.result).toEqual({ ok: true, value: { ok: true } });
    const rows = e.audit.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.toolName).toBe('happy_tool');
    expect(rows[0]!.decision).toBe('allowed');
    expect(rows[0]!.resultStatus).toBe('success');
  });

  it('invoke() returns INVALID_PARAMS when zod parse fails and audits it', async () => {
    const e = bare();
    const registry = newRegistry(e);
    registry.register(happyTool);
    const out = await registry.invoke({
      name: 'happy_tool',
      rawParams: { msg: '' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    expect(out.result.ok).toBe(false);
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('INVALID_PARAMS');
    const rows = e.audit.list();
    expect(rows[0]!.errorCode).toBe('INVALID_PARAMS');
  });

  it('invoke() returns TARGET_NOT_FOUND when the tool name is unknown', async () => {
    const e = bare();
    const registry = newRegistry(e);
    const out = await registry.invoke({
      name: 'unknown_tool',
      rawParams: {},
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    expect(out.decision).toBe('denied');
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('TARGET_NOT_FOUND');
  });

  it('invoke() returns TOOL_TIMEOUT when execute exceeds timeoutMs and audits it', async () => {
    const e = bare();
    const registry = newRegistry(e);
    const slowTool: ToolDefinition<typeof BareSchema, { ok: true }> = {
      ...happyTool,
      name: 'slow_tool',
      timeoutMs: 25,
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { ok: true };
      },
    };
    registry.register(slowTool);
    const out = await registry.invoke({
      name: 'slow_tool',
      rawParams: { msg: 'x' },
      session: e.buildSession(),
      deps: e.buildDeps(),
    });
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.error.code).toBe('TOOL_TIMEOUT');
    expect(out.result.error.retryable).toBe(true);
    const row = e.audit.list()[0]!;
    expect(row.errorCode).toBe('TOOL_TIMEOUT');
  });
});
