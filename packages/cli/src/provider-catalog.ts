import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type ProviderModelDiscovery = 'provider-live' | 'static' | 'unsupported';
export type ProviderConfigFieldType = 'boolean' | 'string' | 'url' | 'secret-ref' | 'model';

export interface ProviderConfigField {
  key: string;
  label: string;
  type: ProviderConfigFieldType;
  description: string;
  sensitive?: boolean;
}

export interface ProviderCatalogEntry {
  id: string;
  displayName: string;
  description: string;
  auth: {
    type: 'env';
    envVars: readonly string[];
    secretRefKey: string;
    defaultSecretRef: string;
  };
  configurableFields: readonly ProviderConfigField[];
  modelDiscovery: ProviderModelDiscovery;
  docsUrl?: string;
}

export const CODEX_PROVIDER_CATALOG_ENTRY: ProviderCatalogEntry = {
  id: 'codex',
  displayName: 'Codex',
  description: 'OpenAI Codex provider for coding-oriented agent runs.',
  auth: {
    type: 'env',
    envVars: ['OPENAI_API_KEY'],
    secretRefKey: 'secretRef',
    defaultSecretRef: 'env:OPENAI_API_KEY',
  },
  configurableFields: [
    {
      key: 'enabled',
      label: 'Enabled',
      type: 'boolean',
      description: 'Enable this provider for Haro provider selection.',
    },
    {
      key: 'secretRef',
      label: 'Secret reference',
      type: 'secret-ref',
      description: 'Reference to a secret source, for example env:OPENAI_API_KEY. The secret value is never written to YAML.',
      sensitive: true,
    },
    {
      key: 'baseUrl',
      label: 'Base URL',
      type: 'url',
      description: 'Optional enterprise/OpenAI-compatible API base URL.',
    },
    {
      key: 'defaultModel',
      label: 'Default model',
      type: 'model',
      description: 'Default model id selected from the provider live model list.',
    },
    {
      key: 'authMode',
      label: 'Auth mode',
      type: 'string',
      description: 'env (OPENAI_API_KEY), chatgpt (codex login subscription), or auto (default).',
    },
  ],
  modelDiscovery: 'provider-live',
  docsUrl: 'https://platform.openai.com/docs',
};

export const DEFAULT_PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = Object.freeze([
  CODEX_PROVIDER_CATALOG_ENTRY,
]);

export function listProviderCatalog(
  catalog: readonly ProviderCatalogEntry[] = DEFAULT_PROVIDER_CATALOG,
): readonly ProviderCatalogEntry[] {
  return catalog;
}

export function getProviderCatalogEntry(
  id: string,
  catalog: readonly ProviderCatalogEntry[] = DEFAULT_PROVIDER_CATALOG,
): ProviderCatalogEntry {
  const entry = catalog.find((item) => item.id === id);
  if (!entry) {
    throw new Error(`Unknown provider '${id}'. Run haro provider list to see supported providers.`);
  }
  return entry;
}

export function secretRefToEnvVar(secretRef: string | undefined, entry: ProviderCatalogEntry): string {
  if (secretRef?.startsWith('env:')) {
    const name = secretRef.slice('env:'.length).trim();
    if (name.length > 0) return name;
  }
  return entry.auth.envVars[0] ?? 'OPENAI_API_KEY';
}

export function resolveProviderEnvFile(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.HARO_PROVIDER_ENV_FILE?.trim();
  if (explicit) return resolve(explicit);
  const configRoot = env.XDG_CONFIG_HOME?.trim() || join(env.HOME?.trim() || homedir(), '.config');
  return join(configRoot, 'haro', 'providers.env');
}

export function providerEnvFileSystemdReference(env: NodeJS.ProcessEnv = process.env): string {
  const defaultHome = env.HOME?.trim() || homedir();
  const defaultPath = join(defaultHome, '.config', 'haro', 'providers.env');
  const actual = resolveProviderEnvFile(env);
  return actual === defaultPath ? '-%h/.config/haro/providers.env' : `-${actual}`;
}
