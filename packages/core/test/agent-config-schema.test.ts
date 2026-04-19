/** FEAT-004 R1 / R2 / AC1 / AC2 — AgentConfig schema rejects unknown fields. */
import { describe, it, expect } from 'vitest';
import {
  AgentSchemaValidationError,
  buildUnknownFieldMessage,
  parseAgentConfig,
} from '../src/agent/index.js';

describe('AgentConfig schema [FEAT-004 R1/R2]', () => {
  it('AC1: accepts minimal well-formed config', () => {
    const res = parseAgentConfig({
      id: 'foo',
      name: 'Foo',
      systemPrompt: 'you are Foo.',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.config).toEqual({
        id: 'foo',
        name: 'Foo',
        systemPrompt: 'you are Foo.',
      });
    }
  });

  it('AC1: accepts optional tools / defaultProvider / defaultModel', () => {
    const res = parseAgentConfig({
      id: 'foo-bar',
      name: 'Foo Bar',
      systemPrompt: 'ok',
      tools: ['Read', 'Grep'],
      defaultProvider: 'codex',
      defaultModel: 'gpt-5-codex',
    });
    expect(res.ok).toBe(true);
  });

  it('AC2: rejects unknown field `role` with spec-mandated message', () => {
    const res = parseAgentConfig({
      id: 'bar',
      name: 'Bar',
      systemPrompt: 'p',
      role: 'engineer',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBeInstanceOf(AgentSchemaValidationError);
      const msgs = res.error.issues.map((i) => i.message);
      expect(msgs).toContain(buildUnknownFieldMessage('role', 'bar'));
    }
  });

  it('AC2: rejects any other unknown field (goal)', () => {
    const res = parseAgentConfig({
      id: 'bar',
      name: 'Bar',
      systemPrompt: 'p',
      goal: 'ship it',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const msg = res.error.issues.map((i) => i.message).join('\n');
      expect(msg).toContain('Unknown field');
      expect(msg).toContain('Agent 的行为由 tools 决定');
    }
  });

  it('AC2: rejects completely anonymous unknown field (foo: 1)', () => {
    const res = parseAgentConfig({
      id: 'bar',
      name: 'Bar',
      systemPrompt: 'p',
      foo: 1,
    });
    expect(res.ok).toBe(false);
  });

  it('AC6: id must be kebab-case', () => {
    const res = parseAgentConfig({
      id: 'UPPER_CASE',
      name: 'X',
      systemPrompt: 'p',
    });
    expect(res.ok).toBe(false);
  });

  it('id length guard (<=64)', () => {
    const tooLong = 'a'.repeat(65);
    const res = parseAgentConfig({
      id: tooLong,
      name: 'X',
      systemPrompt: 'p',
    });
    expect(res.ok).toBe(false);
  });

  it('rejects missing required fields', () => {
    const res = parseAgentConfig({ id: 'ok' });
    expect(res.ok).toBe(false);
  });
});
