import { describe, expect, it } from 'vitest';
import { ChannelRegistry, type ManagedChannel } from '../src/index.js';

function createChannel(id: string): ManagedChannel {
  return {
    id,
    async start() {
      return undefined;
    },
    async stop() {
      return undefined;
    },
    async send() {
      return undefined;
    },
    capabilities() {
      return {
        streaming: false,
        richText: false,
        attachments: false,
        threading: false,
        requiresWebhook: false,
      } as const;
    },
    async healthCheck() {
      return true;
    },
  };
}

describe('ChannelRegistry [FEAT-008]', () => {
  it('register/get/list/enable/disable/remove keep channel state isolated', () => {
    const registry = new ChannelRegistry();
    registry.register({ channel: createChannel('cli'), enabled: true, removable: false, source: 'builtin' });
    registry.register({ channel: createChannel('feishu'), enabled: false, removable: true, source: 'package' });

    expect(registry.get('cli').id).toBe('cli');
    expect(registry.list().map((entry) => [entry.id, entry.enabled])).toEqual([
      ['cli', true],
      ['feishu', false],
    ]);

    registry.enable('feishu');
    expect(registry.getEntry('feishu').enabled).toBe(true);

    registry.disable('cli');
    expect(registry.getEntry('cli').enabled).toBe(false);

    registry.remove('feishu');
    expect(registry.has('feishu')).toBe(false);
  });

  it('refuses to remove a non-removable channel', () => {
    const registry = new ChannelRegistry();
    registry.register({ channel: createChannel('cli'), enabled: true, removable: false, source: 'builtin' });

    expect(() => registry.remove('cli')).toThrow(/cannot be removed/);
  });
});
