import { writeSync } from 'node:fs';
import pino, { Logger } from 'pino';
import { buildHaroPaths } from '../paths.js';

const SECRET_KEY_NAMES = [
  'apiKey',
  'api_key',
  'apikey',
  'appSecret',
  'app_secret',
  'botToken',
  'bot_token',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'password',
  'passwd',
  'secret',
  'privateKey',
  'private_key',
  'authorization',
];

const nativeStdoutWrite = process.stdout.write;

function buildRedactPaths(): string[] {
  const paths = new Set<string>();
  for (const key of SECRET_KEY_NAMES) {
    paths.add(key);
    paths.add(`*.${key}`);
    paths.add(`*.*.${key}`);
  }
  paths.add('headers.authorization');
  paths.add('headers.cookie');
  paths.add('req.headers.authorization');
  paths.add('req.headers.cookie');
  return Array.from(paths);
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'trace';

export interface RollingOptions {
  size?: string;
  limit?: { count: number };
  frequency?: 'daily' | 'hourly' | number;
}

export interface LoggerOptions {
  level?: LogLevel;
  stdout?: boolean;
  file?: string | null;
  root?: string;
  name?: string;
  /**
   * When provided, file output goes through pino-roll (rotating file transport).
   * Phase 0 default is simple dual-output (stdout + sync file append), which keeps
   * AC3 deterministic for the `node -e` sanity check. Callers that want the
   * 10MB × 5 rotation described in the FEAT-001 Design section pass
   * `rolling: true` or a custom policy. Rotation moves file writes into a
   * transport worker thread, so tests that inspect the file should await
   * `logger.flush()` or spawn a child process.
   */
  rolling?: boolean | RollingOptions;
}

export interface LoggerStreamDescriptor {
  readonly level: LogLevel;
  readonly destination: 'stdout' | string;
  readonly rolling?: boolean;
}

export interface HaroLogger extends Logger {
  readonly haroStreams: readonly LoggerStreamDescriptor[];
}

function normalizeRolling(rolling: LoggerOptions['rolling']): Required<RollingOptions> | null {
  if (!rolling) return null;
  const defaults: Required<RollingOptions> = {
    size: '10m',
    limit: { count: 5 },
    frequency: 'daily',
  };
  if (rolling === true) return defaults;
  return {
    size: rolling.size ?? defaults.size,
    limit: rolling.limit ?? defaults.limit,
    frequency: rolling.frequency ?? defaults.frequency,
  };
}

function createRollingLogger(
  level: LogLevel,
  opts: LoggerOptions,
  stdoutPath: boolean,
  filePath: string,
  rolling: Required<RollingOptions>,
): HaroLogger {
  const targets: Array<{
    target: string;
    level: LogLevel;
    options: Record<string, unknown>;
  }> = [];
  if (stdoutPath) {
    targets.push({
      target: 'pino/file',
      level,
      options: { destination: 1, sync: true },
    });
  }
  targets.push({
    target: 'pino-roll',
    level,
    options: {
      file: filePath,
      size: rolling.size,
      limit: rolling.limit,
      frequency: rolling.frequency,
      mkdir: true,
      sync: true,
    },
  });
  const logger = pino({
    name: opts.name,
    level,
    redact: { paths: buildRedactPaths(), censor: '[REDACTED]' },
    transport: { targets },
  }) as HaroLogger;
  const descriptors: LoggerStreamDescriptor[] = [];
  if (stdoutPath) descriptors.push({ level, destination: 'stdout' });
  descriptors.push({ level, destination: filePath, rolling: true });
  Object.defineProperty(logger, 'haroStreams', { value: Object.freeze(descriptors) });
  return logger;
}

function createSimpleLogger(
  level: LogLevel,
  opts: LoggerOptions,
  stdoutPath: boolean,
  filePath: string | null,
): HaroLogger {
  const streamEntries: Array<{ level: LogLevel; stream: NodeJS.WritableStream }> = [];
  const descriptors: LoggerStreamDescriptor[] = [];

  if (stdoutPath) {
    const stdoutStream = {
      write(chunk: Buffer | string): boolean {
        if (process.stdout.write !== nativeStdoutWrite) {
          return process.stdout.write(chunk as never);
        }
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        writeSync(1, buffer);
        return true;
      },
    };
    streamEntries.push({ level, stream: stdoutStream as unknown as NodeJS.WritableStream });
    descriptors.push({ level, destination: 'stdout' });
  }
  if (filePath) {
    const fileStream = pino.destination({ dest: filePath, sync: true, mkdir: true });
    streamEntries.push({ level, stream: fileStream as unknown as NodeJS.WritableStream });
    descriptors.push({ level, destination: filePath, rolling: false });
  }

  const logger = pino(
    {
      name: opts.name,
      level,
      redact: { paths: buildRedactPaths(), censor: '[REDACTED]' },
    },
    pino.multistream(streamEntries),
  ) as HaroLogger;

  Object.defineProperty(logger, 'haroStreams', { value: Object.freeze(descriptors) });
  return logger;
}

function resolveRollingDefault(opts: LoggerOptions): LoggerOptions['rolling'] {
  if (opts.rolling !== undefined) return opts.rolling;
  if (process.env.HARO_LOG_ROLLING === '0') return false;
  if (process.env.HARO_LOG_ROLLING === '1') return true;
  return true;
}

export function createLogger(opts: LoggerOptions = {}): HaroLogger {
  const paths = buildHaroPaths(opts.root);
  const level = (opts.level ?? (process.env.HARO_LOG_LEVEL as LogLevel | undefined) ?? 'info') as LogLevel;
  const useStdout = opts.stdout !== false;
  const filePath = opts.file === null ? null : (opts.file ?? paths.logFile);
  const rolling = normalizeRolling(resolveRollingDefault(opts));

  if (rolling && filePath) {
    return createRollingLogger(level, opts, useStdout, filePath, rolling);
  }
  return createSimpleLogger(level, opts, useStdout, filePath);
}

// Default module-level logger: simple sync dual-output so `require(...).info(...)`
// works deterministically for AC3 (the spec uses `node -e`, which must see the
// log line flushed to file before exit). Opt into pino-roll rotation by calling
// `createLogger({ rolling: true, ... })` explicitly or by setting
// `HARO_LOG_ROLLING=1`. See logger createLogger JSDoc for rationale.
const defaultLogger = (() => {
  try {
    return createLogger({ rolling: false });
  } catch {
    // Keep module import safe in constrained environments (e.g. read-only
    // HOME during subprocess tests) by falling back to stdout-only logging.
    return createLogger({ rolling: false, file: null });
  }
})();

export default defaultLogger;

export function trace(...args: Parameters<Logger['trace']>): void {
  defaultLogger.trace(...args);
}
export function debug(...args: Parameters<Logger['debug']>): void {
  defaultLogger.debug(...args);
}
export function info(...args: Parameters<Logger['info']>): void {
  defaultLogger.info(...args);
}
export function warn(...args: Parameters<Logger['warn']>): void {
  defaultLogger.warn(...args);
}
export function error(...args: Parameters<Logger['error']>): void {
  defaultLogger.error(...args);
}
export function fatal(...args: Parameters<Logger['fatal']>): void {
  defaultLogger.fatal(...args);
}

export function getDefaultLogger(): HaroLogger {
  return defaultLogger;
}
