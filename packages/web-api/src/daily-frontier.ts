import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nextRunAfter, parseCronExpression } from '@haro/core/cron';
import type { WebLogger } from './types.js';

export const DEFAULT_DAILY_FRONTIER_CRON = '0 2 * * *';
export const DAILY_FRONTIER_RUN_DIR = path.join('evolution', 'daily-frontier-runs');

export interface DailyFrontierConfig {
  enabled: boolean;
  cron: string;
  sourceConfigPath: string;
  collectCommand?: string;
  haroCommand?: string;
  runOnStart: boolean;
  commandTimeoutMs: number;
}

export interface DailyFrontierCommandStep {
  name: string;
  command: string;
  startedAt: string;
  completedAt: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  skipped?: boolean;
}

export interface DailyFrontierRunRecord {
  id: string;
  status: 'success' | 'error';
  startedAt: string;
  completedAt: string;
  cron: string;
  sourceConfigPath?: string;
  generatedSourceConfigPath?: string;
  collectCommandConfigured: boolean;
  steps: DailyFrontierCommandStep[];
  error?: string;
}

export interface DailyFrontierStatus {
  enabled: boolean;
  cron: string;
  nextRunAt: string | null;
  running: boolean;
  sourceConfigPath: string;
  collectCommandConfigured: boolean;
  runDirectory: string;
  lastRun?: DailyFrontierRunRecord;
}

export interface DailyFrontierScheduler {
  start(): void;
  stop(): void;
  triggerNow(): Promise<DailyFrontierRunRecord>;
  getStatus(): DailyFrontierStatus;
}

export interface CommandSpec {
  command: string;
  args: string[];
  shell?: boolean;
  display: string;
}

export type DailyFrontierCommandRunner = (
  spec: CommandSpec,
  options: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv },
) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>;

export interface DailyFrontierRuntimeOptions {
  root?: string;
  projectRoot?: string;
  logger: WebLogger;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  runCommand?: DailyFrontierCommandRunner;
}

export function readDailyFrontierConfig(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): DailyFrontierConfig {
  return {
    enabled: env.HARO_DAILY_FRONTIER_ENABLED === '1',
    cron: env.HARO_DAILY_FRONTIER_CRON?.trim() || DEFAULT_DAILY_FRONTIER_CRON,
    sourceConfigPath: path.resolve(
      env.HARO_DAILY_FRONTIER_SOURCE_CONFIG?.trim() || path.join(root, 'frontier-sources.json'),
    ),
    ...(env.HARO_DAILY_FRONTIER_COLLECT_COMMAND?.trim()
      ? { collectCommand: env.HARO_DAILY_FRONTIER_COLLECT_COMMAND.trim() }
      : {}),
    ...(env.HARO_DAILY_FRONTIER_HARO_CMD?.trim()
      ? { haroCommand: env.HARO_DAILY_FRONTIER_HARO_CMD.trim() }
      : {}),
    runOnStart: env.HARO_DAILY_FRONTIER_RUN_ON_START === '1',
    commandTimeoutMs: normalizePositiveInt(env.HARO_DAILY_FRONTIER_TIMEOUT_MS, 10 * 60 * 1000),
  };
}

export function createDailyFrontierScheduler(
  options: DailyFrontierRuntimeOptions,
): DailyFrontierScheduler {
  const root = resolveHaroHome(options.root);
  const config = readDailyFrontierConfig(root, options.env);
  const now = options.now ?? (() => new Date());
  const runCommand = options.runCommand ?? defaultRunCommand;
  const projectRoot = options.projectRoot ?? process.cwd();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let nextRunAt: string | null = config.enabled ? computeNextRunIso(config.cron, now()) : null;
  let stopped = false;

  const scheduleNext = (): void => {
    if (stopped || !config.enabled) return;
    nextRunAt = computeNextRunIso(config.cron, now());
    const delayMs = Math.max(1_000, new Date(nextRunAt).getTime() - now().getTime());
    timer = setTimeout(() => {
      void runOnce().finally(scheduleNext);
    }, delayMs);
    timer.unref?.();
  };

  const runOnce = async (): Promise<DailyFrontierRunRecord> => {
    if (running) {
      throw new Error('Haro daily frontier run is already in progress.');
    }
    running = true;
    try {
      const record = await runDailyFrontierOnce({
        root,
        projectRoot,
        config,
        logger: options.logger,
        env: options.env ?? process.env,
        now,
        runCommand,
      });
      return record;
    } finally {
      running = false;
    }
  };

  return {
    start(): void {
      if (!config.enabled || stopped || timer) return;
      options.logger.info?.(
        {
          cron: config.cron,
          sourceConfigPath: config.sourceConfigPath,
          collectCommandConfigured: Boolean(config.collectCommand),
          nextRunAt,
        },
        'Haro daily frontier scheduler enabled',
      );
      if (config.runOnStart) {
        void runOnce().catch((err) => {
          options.logger.error?.({ err }, 'Haro daily frontier startup run failed');
        });
      }
      scheduleNext();
    },
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    triggerNow: runOnce,
    getStatus(): DailyFrontierStatus {
      return {
        enabled: config.enabled,
        cron: config.cron,
        nextRunAt,
        running,
        sourceConfigPath: config.sourceConfigPath,
        collectCommandConfigured: Boolean(config.collectCommand),
        runDirectory: runRecordsDir(root),
        ...(readLatestRunRecord(root) ? { lastRun: readLatestRunRecord(root)! } : {}),
      };
    },
  };
}

export async function runDailyFrontierOnce(input: {
  root: string;
  projectRoot: string;
  config: DailyFrontierConfig;
  logger: WebLogger;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  runCommand?: DailyFrontierCommandRunner;
}): Promise<DailyFrontierRunRecord> {
  const now = input.now ?? (() => new Date());
  const runCommand = input.runCommand ?? defaultRunCommand;
  const env = input.env ?? process.env;
  const startedAt = now().toISOString();
  const runId = `daily_frontier_${compactTimestamp(startedAt)}`;
  const steps: DailyFrontierCommandStep[] = [];
  let sourceConfigPath: string | undefined;
  let generatedSourceConfigPath: string | undefined;
  let status: DailyFrontierRunRecord['status'] = 'success';
  let error: string | undefined;

  try {
    if (input.config.collectCommand) {
      const collect = await executeStep(
        {
          command: input.config.collectCommand,
          args: [],
          shell: true,
          display: input.config.collectCommand,
        },
        {
          projectRoot: input.projectRoot,
          timeoutMs: input.config.commandTimeoutMs,
          env,
          now,
          runCommand,
          name: 'collect-frontier-source-config',
        },
      );
      steps.push(collect);
      if (collect.exitCode !== 0) {
        throw new Error(`frontier collect command failed with exit code ${collect.exitCode}`);
      }
      if (!collect.stdout.trim()) {
        throw new Error('frontier collect command produced empty stdout');
      }
      JSON.parse(collect.stdout) as unknown;
      generatedSourceConfigPath = path.join(
        input.root,
        'evolution',
        'generated-frontier-sources',
        `${runId}.json`,
      );
      writeJsonTextAtomic(generatedSourceConfigPath, collect.stdout);
      sourceConfigPath = generatedSourceConfigPath;
    } else if (existsSync(input.config.sourceConfigPath)) {
      sourceConfigPath = input.config.sourceConfigPath;
    }

    if (sourceConfigPath) {
      const step = await executeHaroStep(
        'intake-frontier',
        ['intake', 'frontier', '--source-config', sourceConfigPath, '--since', 'last', '--json'],
        input,
      );
      steps.push(step);
      assertStepSucceeded(step);
    } else {
      steps.push({
        name: 'intake-frontier',
        command: `haro intake frontier --source-config ${input.config.sourceConfigPath} --since last --json`,
        startedAt: now().toISOString(),
        completedAt: now().toISOString(),
        exitCode: 0,
        stdout: '',
        stderr: `Skipped: no source config found at ${input.config.sourceConfigPath} and HARO_DAILY_FRONTIER_COLLECT_COMMAND is not configured.`,
        skipped: true,
      });
    }

    const observe = await executeHaroStep(
      'observe',
      ['observe', '--since', 'last', '--json'],
      input,
    );
    steps.push(observe);
    assertStepSucceeded(observe);
    const propose = await executeHaroStep(
      'propose',
      ['propose', '--auto-dry-run', '--include-frontier', '--json'],
      input,
    );
    steps.push(propose);
    assertStepSucceeded(propose);
    const validate = await executeHaroStep('validate', ['validate', '--pending', '--json'], input);
    steps.push(validate);
    assertStepSucceeded(validate);
    const approvalRequest = await executeHaroStep(
      'approval-request',
      ['approval-request', '--pending', '--json'],
      input,
    );
    steps.push(approvalRequest);
    assertStepSucceeded(approvalRequest);
  } catch (err) {
    status = 'error';
    error = err instanceof Error ? err.message : String(err);
    input.logger.error?.({ err }, 'Haro daily frontier run failed');
  }

  const record: DailyFrontierRunRecord = {
    id: runId,
    status,
    startedAt,
    completedAt: now().toISOString(),
    cron: input.config.cron,
    ...(sourceConfigPath ? { sourceConfigPath } : {}),
    ...(generatedSourceConfigPath ? { generatedSourceConfigPath } : {}),
    collectCommandConfigured: Boolean(input.config.collectCommand),
    steps,
    ...(error ? { error } : {}),
  };
  writeRunRecord(input.root, record);
  return record;
}

function assertStepSucceeded(step: DailyFrontierCommandStep): void {
  if (!step.skipped && step.exitCode !== 0) {
    throw new Error(`${step.name} failed with exit code ${step.exitCode}`);
  }
}

async function executeHaroStep(
  name: string,
  args: string[],
  input: {
    projectRoot: string;
    config: DailyFrontierConfig;
    env?: NodeJS.ProcessEnv;
    now?: () => Date;
    runCommand?: DailyFrontierCommandRunner;
  },
): Promise<DailyFrontierCommandStep> {
  return executeStep(resolveHaroCommand(args, input.config, input.env ?? process.env), {
    projectRoot: input.projectRoot,
    timeoutMs: input.config.commandTimeoutMs,
    env: input.env ?? process.env,
    now: input.now ?? (() => new Date()),
    runCommand: input.runCommand ?? defaultRunCommand,
    name,
  });
}

async function executeStep(
  spec: CommandSpec,
  input: {
    projectRoot: string;
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
    now: () => Date;
    runCommand: DailyFrontierCommandRunner;
    name?: string;
  },
): Promise<DailyFrontierCommandStep> {
  const startedAt = input.now().toISOString();
  const result = await input.runCommand(spec, {
    cwd: input.projectRoot,
    timeoutMs: input.timeoutMs,
    env: input.env,
  });
  return {
    name: input.name ?? spec.display,
    command: spec.display,
    startedAt,
    completedAt: input.now().toISOString(),
    exitCode: result.exitCode,
    stdout: truncate(result.stdout, 20_000),
    stderr: truncate(result.stderr, 20_000),
  };
}

function resolveHaroCommand(
  args: string[],
  config: DailyFrontierConfig,
  env: NodeJS.ProcessEnv,
): CommandSpec {
  const configured = config.haroCommand ?? env.HARO_CLI?.trim();
  if (configured) {
    const display = `${configured} ${args.map(shellQuote).join(' ')}`;
    return { command: display, args: [], shell: true, display };
  }

  const entrypoint = process.argv[1];
  if (entrypoint && /packages\/cli\/(dist\/index\.js|bin\/haro\.js)$/.test(entrypoint)) {
    return {
      command: process.execPath,
      args: [entrypoint, ...args],
      display: `${process.execPath} ${[entrypoint, ...args].map(shellQuote).join(' ')}`,
    };
  }

  return { command: 'haro', args, display: `haro ${args.map(shellQuote).join(' ')}` };
}

function defaultRunCommand(
  spec: CommandSpec,
  options: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv },
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, {
      cwd: options.cwd,
      env: options.env,
      shell: spec.shell ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      stderr += `\nCommand timed out after ${options.timeoutMs}ms.`;
    }, options.timeoutMs);
    timer.unref?.();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${err.message}`.trim() });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

function resolveHaroHome(root?: string): string {
  return path.resolve(root ?? process.env.HARO_HOME ?? path.join(os.homedir(), '.haro'));
}

function computeNextRunIso(cron: string, from: Date): string {
  return new Date(nextRunAfter(parseCronExpression(cron), from)).toISOString();
}

function runRecordsDir(root: string): string {
  return path.join(root, DAILY_FRONTIER_RUN_DIR);
}

function readLatestRunRecord(root: string): DailyFrontierRunRecord | undefined {
  const dir = runRecordsDir(root);
  if (!existsSync(dir)) return undefined;
  const latest = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .at(-1);
  if (!latest) return undefined;
  try {
    return JSON.parse(readFileSync(path.join(dir, latest), 'utf8')) as DailyFrontierRunRecord;
  } catch {
    return undefined;
  }
}

function writeRunRecord(root: string, record: DailyFrontierRunRecord): void {
  const filePath = path.join(runRecordsDir(root), `${record.id}.json`);
  writeJsonTextAtomic(filePath, JSON.stringify(record, null, 2));
}

function writeJsonTextAtomic(filePath: string, text: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, `${text.trim()}\n`, 'utf8');
    renameSync(tmp, filePath);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function normalizePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function compactTimestamp(value: string): string {
  return value.replace(/[^0-9A-Za-z]+/g, '').slice(0, 24);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...<truncated ${value.length - max} chars>`;
}
