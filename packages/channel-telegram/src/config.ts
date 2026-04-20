export type TelegramSessionScope = 'per-chat' | 'per-user';

export interface TelegramChannelConfig {
  enabled?: boolean;
  botToken?: string;
  transport?: 'long-polling';
  allowedUpdates?: string[];
  sessionScope?: TelegramSessionScope;
}

const ENV_PATTERN = /^\$\{([A-Z0-9_]+)\}$/;

export function interpolateEnv(value: string | undefined): string | undefined {
  if (!value) return value;
  const match = ENV_PATTERN.exec(value.trim());
  if (!match) return value;
  return process.env[match[1]!];
}

export function resolveTelegramConfig(input: Record<string, unknown>): Required<TelegramChannelConfig> {
  const botToken = interpolateEnv(asOptionalString(input.botToken));
  const allowedUpdates = Array.isArray(input.allowedUpdates)
    ? input.allowedUpdates.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : ['message'];
  const sessionScope = asOptionalString(input.sessionScope) === 'per-user' ? 'per-user' : 'per-chat';
  return {
    enabled: input.enabled === true,
    botToken: botToken ?? '',
    transport: 'long-polling',
    allowedUpdates: allowedUpdates.length > 0 ? allowedUpdates : ['message'],
    sessionScope,
  };
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
