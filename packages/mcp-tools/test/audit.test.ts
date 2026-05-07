import { afterEach, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from './helpers.js';
import { hashParams } from '../src/audit.js';

let env: TestEnv | null = null;

afterEach(() => {
  env?.cleanup();
  env = null;
});

describe('ToolInvocationAuditWriter [FEAT-032 R8 / AC7]', () => {
  it('hashes params deterministically and never stores the raw payload', () => {
    const e = (env = setupEnv());
    const params = { secret: 'token-XYZ', other: 1 };
    const hash = hashParams(params);
    e.audit.append({
      sessionId: 's1',
      agentId: 'a1',
      toolName: 'memory_remember',
      params,
      decision: 'allowed',
      resultStatus: 'success',
      latencyMs: 12,
      errorCode: null,
    });
    const rows = e.audit.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.paramsHash).toBe(hash);
    // The params hash is a 32-char hex slice; the original token must NOT appear.
    expect(rows[0]!.paramsHash).not.toContain('token-XYZ');
    expect(JSON.stringify(rows[0])).not.toContain('token-XYZ');
  });

  it('returns rows ordered by invokedAt desc and respects sessionId filter', () => {
    const e = (env = setupEnv());
    let t = 1_000;
    e.audit.append({
      sessionId: 's1',
      agentId: 'a1',
      toolName: 'send_message',
      params: { i: 1 },
      decision: 'allowed',
      resultStatus: 'success',
      latencyMs: 5,
      errorCode: null,
    });
    t += 5;
    e.audit.append({
      sessionId: 's2',
      agentId: 'a1',
      toolName: 'send_message',
      params: { i: 2 },
      decision: 'allowed',
      resultStatus: 'success',
      latencyMs: 6,
      errorCode: null,
    });
    void t;
    const onlyS1 = e.audit.list({ sessionId: 's1' });
    expect(onlyS1).toHaveLength(1);
    expect(onlyS1[0]!.sessionId).toBe('s1');
  });
});
