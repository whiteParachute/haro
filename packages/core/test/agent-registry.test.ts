/** FEAT-004 R4 / AC3 — AgentRegistry behaviour. */
import { describe, it, expect } from 'vitest';
import {
  AgentRegistry,
  AgentIdConflictError,
  AgentNotFoundError,
} from '../src/agent/index.js';

const cfg = (id: string) => ({
  id,
  name: id,
  systemPrompt: 'p',
});

describe('AgentRegistry [FEAT-004 R4]', () => {
  it('register + get + has + list round-trip', () => {
    const r = new AgentRegistry();
    r.register(cfg('alpha'));
    expect(r.has('alpha')).toBe(true);
    expect(r.get('alpha').id).toBe('alpha');
    expect(r.list().map((c) => c.id)).toEqual(['alpha']);
    expect(r.size()).toBe(1);
  });

  it('tryGet returns undefined for missing id', () => {
    const r = new AgentRegistry();
    expect(r.tryGet('missing')).toBeUndefined();
  });

  it('get throws for missing id', () => {
    const r = new AgentRegistry();
    expect(() => r.get('missing')).toThrow(AgentNotFoundError);
  });

  it('AC3: duplicate id throws AgentIdConflictError', () => {
    const r = new AgentRegistry();
    r.register(cfg('alpha'));
    expect(() => r.register(cfg('alpha'))).toThrow(AgentIdConflictError);
  });

  it('returns frozen config snapshots so list consumers cannot mutate', () => {
    const r = new AgentRegistry();
    r.register(cfg('alpha'));
    const snapshot = r.list();
    expect(() => {
      (snapshot as { push?: (x: unknown) => number }).push?.(cfg('beta'));
    }).toThrow();
  });
});
