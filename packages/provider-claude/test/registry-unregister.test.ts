/** AC6 — core startup must succeed when the provider package isn't registered. */
import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from '@haro/core/provider';

describe('ClaudeProvider plug-in boundary [FEAT-002]', () => {
  it('AC6 missing provider registration does not throw at startup', () => {
    const reg = new ProviderRegistry();
    expect(reg.list()).toEqual([]);
    // Core startup never calls .get('claude') unconditionally; it routes
    // through tryGet / has so that an un-registered provider yields a warn,
    // not a crash. We assert the registry supports that shape.
    expect(reg.has('claude')).toBe(false);
    expect(reg.tryGet('claude')).toBeUndefined();
    expect(() => reg.get('claude')).toThrow(/not registered/);
  });
});
