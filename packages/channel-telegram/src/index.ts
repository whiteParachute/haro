export { TelegramChannel, type TelegramChannelOptions } from './telegram-channel.js';
export { resolveTelegramConfig, type TelegramChannelConfig, type TelegramSessionScope } from './config.js';
export {
  createGrammyTransport,
  extractTelegramAttachments,
  mapTelegramUpdate,
  type TelegramAttachmentMeta,
  type TelegramInboundEvent,
  type TelegramSessionRuntime,
  type TelegramTransport,
} from './transport.js';
