/** AC4 — capabilities() returns a shape matching AgentCapabilities. */
import { describe, it, expect } from 'vitest';
import { createClaudeProvider } from '../src/index.js';

describe('ClaudeProvider.capabilities [FEAT-002]', () => {
  it('AC4 returns the FEAT-002 R4 capability matrix (streaming + toolLoop + contextCompaction)', () => {
    const p = createClaudeProvider({ defaultModel: 'claude-sonnet-4-6' }, { skipEnvGuard: true });
    const cap = p.capabilities();
    expect(cap.streaming).toBe(true);
    expect(cap.toolLoop).toBe(true);
    expect(cap.contextCompaction).toBe(true);
    expect(cap.permissionModes).toEqual(['plan', 'auto', 'bypass']);
    expect(typeof cap.maxContextTokens).toBe('number');
  });

  it('AC4 picks up the 1M context variant when model is opus[1m]', () => {
    const p = createClaudeProvider({ defaultModel: 'claude-opus-4-7[1m]' }, { skipEnvGuard: true });
    expect(p.capabilities().maxContextTokens).toBe(1_000_000);
  });

  it('R1 id is the literal "claude"', () => {
    const p = createClaudeProvider({}, { skipEnvGuard: true });
    expect(p.id).toBe('claude');
  });
});
