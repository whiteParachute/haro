export { ChannelRegistry } from './registry.js';
export { CliChannel, type CliChannelOptions } from './cli-channel.js';
export { ChannelSessionStore, type SessionStoreRecord } from './session-store.js';
export { readJsonFile, writeJsonFile } from './state-file.js';
export type {
  ChannelCapabilities,
  ChannelContext,
  ChannelDoctorResult,
  ChannelLogger,
  ChannelRegistration,
  ChannelRegistryEntry,
  ChannelSetupContext,
  ChannelSetupResult,
  InboundMessage,
  ManagedChannel,
  MessageChannel,
  OutboundMessage,
} from './protocol.js';
