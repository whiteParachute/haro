import { services } from '@haro/core';

export const REDACTED_SECRET_VALUE = '[redacted]';

export function findSecretConfigPaths(value: unknown): string[] {
  const paths: string[] = [];
  walkConfigPaths('', value, (path) => {
    if (path && services.config.isSecretPath(path)) paths.push(path);
  });
  return paths;
}

export function redactConfigSecrets<T>(value: T, basePath = ''): T {
  return redactAtPath(basePath, value) as T;
}

function redactAtPath(path: string, value: unknown): unknown {
  if (path && services.config.isSecretPath(path)) return REDACTED_SECRET_VALUE;
  if (Array.isArray(value)) {
    return value.map((item, index) => redactAtPath(`${path}.${index}`, item));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      redactAtPath(path ? `${path}.${key}` : key, nested),
    ]),
  );
}

function walkConfigPaths(
  path: string,
  value: unknown,
  visit: (path: string) => void,
): void {
  if (path) visit(path);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      walkConfigPaths(`${path}.${index}`, item, visit),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    walkConfigPaths(path ? `${path}.${key}` : key, nested, visit);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
