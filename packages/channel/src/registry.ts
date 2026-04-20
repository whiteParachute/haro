import type {
  ChannelRegistration,
  ChannelRegistryEntry,
  ManagedChannel,
} from './protocol.js';

export class ChannelRegistry {
  private readonly channels = new Map<string, ChannelRegistryEntry>();

  register(input: ChannelRegistration): void {
    const id = input.channel.id;
    if (this.channels.has(id)) {
      throw new Error(`Channel '${id}' already registered`);
    }
    this.channels.set(id, {
      id,
      channel: input.channel,
      enabled: input.enabled ?? false,
      removable: input.removable ?? true,
      source: input.source ?? 'package',
      displayName: input.displayName ?? id,
    });
  }

  get(id: string): ManagedChannel {
    return this.getEntry(id).channel;
  }

  getEntry(id: string): ChannelRegistryEntry {
    const entry = this.channels.get(id);
    if (!entry) throw new Error(`Channel '${id}' not registered`);
    return entry;
  }

  has(id: string): boolean {
    return this.channels.has(id);
  }

  list(): readonly ChannelRegistryEntry[] {
    return Array.from(this.channels.values()).sort((left, right) => left.id.localeCompare(right.id));
  }

  listEnabled(): readonly ChannelRegistryEntry[] {
    return this.list().filter((entry) => entry.enabled);
  }

  enable(id: string): ChannelRegistryEntry {
    const entry = this.getEntry(id);
    entry.enabled = true;
    return entry;
  }

  disable(id: string): ChannelRegistryEntry {
    const entry = this.getEntry(id);
    entry.enabled = false;
    return entry;
  }

  remove(id: string): ChannelRegistryEntry {
    const entry = this.getEntry(id);
    if (!entry.removable) {
      throw new Error(`Channel '${id}' cannot be removed`);
    }
    this.channels.delete(id);
    return entry;
  }

  async stop(): Promise<void> {
    const entries = this.list();
    for (const entry of entries) {
      await entry.channel.stop();
    }
  }
}
