export type FeishuSessionScope = 'per-chat' | 'per-user';

export interface FeishuChannelConfig {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  transport?: 'websocket';
  sessionScope?: FeishuSessionScope;
}

const ENV_PATTERN = /^\$\{([A-Z0-9_]+)\}$/;

export function interpolateEnv(value: string | undefined): string | undefined {
  if (!value) return value;
  const match = ENV_PATTERN.exec(value.trim());
  if (!match) return value;
  return process.env[match[1]!];
}

export function resolveFeishuConfig(input: Record<string, unknown>): Required<FeishuChannelConfig> {
  const appId = interpolateEnv(asOptionalString(input.appId));
  const appSecret = interpolateEnv(asOptionalString(input.appSecret));
  const transport = asOptionalString(input.transport) === 'websocket' ? 'websocket' : 'websocket';
  const sessionScope = asOptionalString(input.sessionScope) === 'per-user' ? 'per-user' : 'per-chat';

  return {
    enabled: input.enabled === true,
    appId: appId ?? '',
    appSecret: appSecret ?? '',
    transport,
    sessionScope,
  };
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
