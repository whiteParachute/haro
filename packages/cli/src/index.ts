import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  AgentRegistry,
  AgentRunner,
  DEFAULT_AGENT_ID,
  ProviderRegistry,
  buildHaroPaths,
  createLogger,
  db as haroDb,
  fs as haroFs,
  loadAgentsFromDir,
  resolveSelection,
  type HaroLogger,
  type HaroPaths,
} from '@haro/core';
import { createCodexProvider } from '@haro/provider-codex';
import * as haroConfig from '@haro/core/config';
import type { HaroConfig, LoadedConfig } from '@haro/core/config';
import type { AgentProvider } from '@haro/core/provider';
import {
  ChannelRegistry,
  CliChannel,
  type InboundMessage,
  type MessageChannel,
} from './channel.js';

const VERSION = '0.0.0';
const CLI_CHANNEL_STATE_FILE = 'state.json';
const DEFAULT_TASK = '列出当前目录下的 TypeScript 文件';

type CliLogger = Pick<HaroLogger, 'debug' | 'info' | 'warn' | 'error'>;

export interface RunCliOptions {
  argv?: readonly string[];
  root?: string;
  projectRoot?: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  now?: () => Date;
  createSessionId?: () => string;
  createConversationId?: () => string;
  loadConfig?: (input: {
    root?: string;
    projectRoot?: string;
    cliOverrides?: Partial<HaroConfig>;
  }) => LoadedConfig;
  createProviderRegistry?: (input: { config: LoadedConfig['config'] }) => Promise<ProviderRegistry>;
  loadAgentRegistry?: (input: {
    agentsDir: string;
    providerRegistry: ProviderRegistry;
    logger: CliLogger;
  }) => Promise<AgentRegistry>;
  createRunner?: (input: {
    agentRegistry: AgentRegistry;
    providerRegistry: ProviderRegistry;
    logger: CliLogger;
    root?: string;
    projectRoot?: string;
    createSessionId?: () => string;
  }) => AgentRunner;
  channelFactory?: (input: {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    stdin: NodeJS.ReadableStream;
    startRepl: boolean;
    now: () => Date;
    createConversationId?: () => string;
    onLocalCommand?: (line: string, channel: CliChannel) => Promise<boolean>;
  }) => CliChannel;
}

export type RunCliAction =
  | 'version'
  | 'help'
  | 'run'
  | 'repl'
  | 'model'
  | 'config'
  | 'doctor'
  | 'status'
  | 'config-error';

export interface RunCliResult {
  exitCode: number;
  action: RunCliAction;
  paths: HaroPaths;
  createdDirs: string[];
  error?: Error;
}

interface CliState {
  defaultAgentId?: string;
  defaultProvider?: string;
  defaultModel?: string;
}

interface ReplState {
  agentId: string;
  providerOverride?: string;
  modelOverride?: string;
  lastUserTask?: string;
  lastSessionId?: string;
  continueLatestSession: boolean;
}

interface ExecutionOptions {
  task: string;
  agentId: string;
  provider?: string;
  model?: string;
  noMemory?: boolean;
  retryOfSessionId?: string;
  continueLatestSession?: boolean;
}

interface AppContext {
  opts: RunCliOptions;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadableStream;
  now: () => Date;
  paths: HaroPaths;
  logger: CliLogger;
  channelRegistry: ChannelRegistry;
  cliState: CliState;
  writeCliState(next: CliState): void;
  loaded: LoadedConfig;
  providerRegistry: ProviderRegistry;
  agentRegistry: AgentRegistry;
  runner: AgentRunner;
  createdDirs: string[];
}

class CommanderExit extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'CommanderExit';
    this.code = code;
  }
}

export function registerCommand(
  name: string,
  configure: (cmd: Command) => void,
  parent: Command,
): void {
  configure(parent.command(name));
}

export async function runCli(opts: RunCliOptions = {}): Promise<RunCliResult> {
  const argv = opts.argv ?? process.argv.slice(2);
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const stdin = opts.stdin ?? process.stdin;
  const paths = buildHaroPaths(opts.root);

  if (argv.includes('--version') || argv[0] === 'version') {
    stdout.write(`${VERSION}\n`);
    return { exitCode: 0, action: 'version', paths, createdDirs: [] };
  }

  const bootstrap = await bootstrapApp({ ...opts, stdout, stderr, stdin });
  if ('error' in bootstrap) {
    stderr.write(`${bootstrap.error.message}\n`);
    return {
      exitCode: 1,
      action: 'config-error',
      paths,
      createdDirs: [],
      error: bootstrap.error,
    };
  }

  const app = bootstrap;
  const program = buildProgram(app);

  try {
    await program.parseAsync(['node', 'haro', ...argv], { from: 'node' });
    await app.channelRegistry.stop();
    return commandResult(app, inferAction(argv), 0);
  } catch (err) {
    await app.channelRegistry.stop();
    if (err instanceof CommanderExit) {
      return commandResult(app, inferAction(argv), err.code, err);
    }
    throw err;
  }
}

function buildProgram(app: AppContext): Command {
  const program = new Command();
  program
    .name('haro')
    .description('Haro CLI runtime surface')
    .showHelpAfterError()
    .exitOverride((error: { exitCode: number; message: string }) => {
      throw new CommanderExit(error.exitCode, error.message);
    });

  program.action(async () => {
    await runRepl(app);
  });

  registerCommand(
    'run',
    (cmd) => {
      cmd
        .argument('<task>', 'task text')
        .option('--agent <id>', 'agent id')
        .option('--provider <id>', 'provider override')
        .option('--model <id>', 'model override')
        .option('--no-memory', 'disable memory read/write and wrapup for this session')
        .action(
          async (
            task: string,
            options: { agent?: string; provider?: string; model?: string; noMemory?: boolean; memory?: boolean },
          ) => {
            const agentId =
              options.agent ??
              app.cliState.defaultAgentId ??
              app.loaded.config.defaultAgent ??
              DEFAULT_AGENT_ID;
            const result = await executeTask(app, {
              task,
              agentId,
              provider: options.provider ?? app.cliState.defaultProvider,
              model: options.model ?? app.cliState.defaultModel,
              noMemory: options.noMemory ?? options.memory === false,
            });
            if (result.finalEvent.type !== 'result') {
              throw new CommanderExit(1, result.finalEvent.message);
            }
          },
        );
    },
    program,
  );

  registerCommand(
    'model',
    (cmd) => {
      cmd
        .argument('[provider]', 'provider id')
        .argument('[model]', 'model id')
        .action(async (provider?: string, model?: string) => {
          const agentId =
            app.cliState.defaultAgentId ?? app.loaded.config.defaultAgent ?? DEFAULT_AGENT_ID;
          if (!provider) {
            const resolved = await resolveRouteSummary(
              app,
              agentId,
              app.cliState.defaultProvider,
              app.cliState.defaultModel,
              DEFAULT_TASK,
            );
            app.stdout.write(formatModelOutput('current', resolved));
            return;
          }

          await assertProviderAndModel(app.providerRegistry, provider, model);
          const next: CliState = {
            ...app.cliState,
            defaultProvider: provider,
          };
          if (model) {
            next.defaultModel = model;
          } else {
            delete next.defaultModel;
          }
          app.writeCliState(next);
          app.stdout.write(`CLI 默认 Provider/Model 已切换到 ${provider}${model ? `/${model}` : ''}\n`);
        });
    },
    program,
  );

  registerCommand(
    'config',
    (cmd) => {
      cmd.action(async () => {
        app.stdout.write(
          `${JSON.stringify({ sources: app.loaded.sources, config: app.loaded.config }, null, 2)}\n`,
        );
      });
    },
    program,
  );

  registerCommand(
    'doctor',
    (cmd) => {
      cmd.action(async () => {
        const report = await runDoctor(app);
        app.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        if (!report.ok) {
          throw new CommanderExit(1, 'doctor found issues');
        }
      });
    },
    program,
  );

  registerCommand(
    'status',
    (cmd) => {
      cmd.action(async () => {
        const report = readStatus(app.paths.root, app.paths.dbFile);
        app.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      });
    },
    program,
  );

  return program;
}

async function bootstrapApp(
  input: RunCliOptions & {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    stdin: NodeJS.ReadableStream;
  },
): Promise<AppContext | { error: Error }> {
  const now = input.now ?? (() => new Date());
  const paths = buildHaroPaths(input.root);
  const logger = buildLogger(input.root);
  const loadConfig =
    input.loadConfig ??
    ((opts: {
      root?: string;
      projectRoot?: string;
      cliOverrides?: Partial<HaroConfig>;
    }): LoadedConfig =>
      haroConfig.loadHaroConfig({
        globalRoot: opts.root,
        projectRoot: opts.projectRoot,
        cliOverrides: opts.cliOverrides,
      }));

  let loaded: LoadedConfig;
  try {
    loaded = loadConfig({ root: input.root, projectRoot: input.projectRoot });
  } catch (err) {
    if (err instanceof haroConfig.HaroConfigValidationError) {
      return { error: err instanceof Error ? err : new Error(String(err)) };
    }
    throw err;
  }

  const dirResult = haroFs.ensureHaroDirectories(input.root);
  haroDb.initHaroDatabase({ root: input.root });

  const providerRegistry = input.createProviderRegistry
    ? await input.createProviderRegistry({ config: loaded.config })
    : await createDefaultProviderRegistry(loaded.config);

  const agentRegistry = input.loadAgentRegistry
    ? await input.loadAgentRegistry({
        agentsDir: paths.dirs.agents,
        providerRegistry,
        logger,
      })
    : (
        await loadAgentsFromDir({
          agentsDir: paths.dirs.agents,
          providerRegistry,
          logger,
        })
      ).registry;

  const runner = input.createRunner
    ? input.createRunner({
        agentRegistry,
        providerRegistry,
        logger,
        root: input.root,
        projectRoot: input.projectRoot,
        createSessionId: input.createSessionId,
      })
    : new AgentRunner({
        agentRegistry,
        providerRegistry,
        root: input.root,
        projectRoot: input.projectRoot,
        createSessionId: input.createSessionId,
        logger,
      });

  const app: AppContext = {
    opts: input,
    stdout: input.stdout,
    stderr: input.stderr,
    stdin: input.stdin,
    now,
    paths,
    logger,
    channelRegistry: new ChannelRegistry(),
    cliState: readCliState(paths.root),
    writeCliState: (next: CliState) => {
      writeCliChannelState(paths.root, next);
      app.cliState = next;
    },
    loaded,
    providerRegistry,
    agentRegistry,
    runner,
    createdDirs: dirResult.created,
  };

  return app;
}

async function runRepl(app: AppContext): Promise<void> {
  const replState: ReplState = {
    agentId:
      app.cliState.defaultAgentId ?? app.loaded.config.defaultAgent ?? DEFAULT_AGENT_ID,
    providerOverride: app.cliState.defaultProvider,
    modelOverride: app.cliState.defaultModel,
    continueLatestSession: true,
  };

  const channel = (app.opts.channelFactory ?? defaultChannelFactory)({
    stdout: app.stdout,
    stderr: app.stderr,
    stdin: app.stdin,
    startRepl: true,
    now: app.now,
    createConversationId: app.opts.createConversationId,
    onLocalCommand: async (line, cliChannel) =>
      handleSlashCommand(app, replState, cliChannel, line),
  });
  app.channelRegistry.register(channel);

  const route = await resolveRouteSummary(
    app,
    replState.agentId,
    replState.providerOverride,
    replState.modelOverride,
    DEFAULT_TASK,
  );
  await channel.showBanner(route);
  await channel.start({
    config: app.loaded.config.channels?.cli ?? {},
    logger: app.logger,
    onInbound: async (msg) => handleInbound(app, replState, channel, msg),
  });
}

async function handleInbound(
  app: AppContext,
  replState: ReplState,
  channel: CliChannel,
  msg: InboundMessage,
): Promise<void> {
  const task = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
  const result = await executeTask(
    app,
    {
      task,
      agentId: replState.agentId,
      provider: replState.providerOverride,
      model: replState.modelOverride,
      continueLatestSession: replState.continueLatestSession,
    },
    channel,
  );
  replState.lastUserTask = task;
  replState.lastSessionId = result.sessionId;
  replState.continueLatestSession = true;
}

async function executeTask(
  app: AppContext,
  input: ExecutionOptions,
  channel?: MessageChannel,
) {
  app.agentRegistry.get(input.agentId);
  const result = await app.runner.run({
    task: input.task,
    agentId: input.agentId,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.noMemory ? { noMemory: true } : {}),
    ...(input.retryOfSessionId ? { retryOfSessionId: input.retryOfSessionId } : {}),
    ...(input.continueLatestSession === false ? { continueLatestSession: false } : {}),
  });

  const outputChannel =
    channel ??
    (app.opts.channelFactory ?? defaultChannelFactory)({
      stdout: app.stdout,
      stderr: app.stderr,
      stdin: app.stdin,
      startRepl: false,
      now: app.now,
      createConversationId: app.opts.createConversationId,
    });
  if (!channel) {
    app.channelRegistry.register(outputChannel);
    await outputChannel.start({
      config: {},
      logger: app.logger,
      onInbound: async () => undefined,
    });
  }

  for (const event of result.events) {
    if (event.type === 'text') {
      await outputChannel.send(result.sessionId, {
        type: 'text',
        content: event.content,
        delta: event.delta,
      });
    } else if (event.type === 'result') {
      await outputChannel.send(result.sessionId, {
        type: 'text',
        content: event.content,
      });
    } else if (event.type === 'error') {
      await outputChannel.send(result.sessionId, {
        type: 'text',
        content: `ERROR [${event.code}] ${event.message}`,
      });
    }
  }

  return result;
}

async function handleSlashCommand(
  app: AppContext,
  replState: ReplState,
  channel: CliChannel,
  line: string,
): Promise<boolean> {
  const [command, ...args] = line.split(/\s+/);
  switch (command) {
    case '/help':
      channel.writeLine(
        [
          '/model [provider] [model]',
          '/new',
          '/retry',
          '/compress',
          '/skills',
          '/usage',
          '/agent <id>',
          '/help',
        ].join('\n'),
      );
      return true;

    case '/new':
      replState.lastSessionId = undefined;
      replState.lastUserTask = undefined;
      replState.continueLatestSession = false;
      channel.resetConversation();
      channel.writeLine('已开始新的 CLI 会话；下一条消息将不续接上一轮上下文。');
      return true;

    case '/retry': {
      if (!replState.lastUserTask || !replState.lastSessionId) {
        channel.writeLine('当前没有可重试的上一条用户输入。');
        return true;
      }
      const retryResult = await executeTask(
        app,
        {
          task: replState.lastUserTask,
          agentId: replState.agentId,
          provider: replState.providerOverride,
          model: replState.modelOverride,
          retryOfSessionId: replState.lastSessionId,
          continueLatestSession: false,
        },
        channel,
      );
      replState.lastSessionId = retryResult.sessionId;
      replState.continueLatestSession = true;
      return true;
    }

    case '/compress': {
      const current = await resolveRouteSummary(
        app,
        replState.agentId,
        replState.providerOverride,
        replState.modelOverride,
        DEFAULT_TASK,
      );
      const provider = app.providerRegistry.get(current.provider);
      if (!provider.capabilities().contextCompaction) {
        channel.writeLine('当前 Provider 不支持上下文压缩');
        return true;
      }
      channel.writeLine('当前 Provider 支持上下文压缩，但 Phase 0 尚未接入压缩执行路径。');
      return true;
    }

    case '/skills':
      channel.writeLine('FEAT-010 尚未交付：当前仅保留 /skills 占位说明。');
      return true;

    case '/usage': {
      const usage = readUsage(app.paths.root, app.paths.dbFile, replState.lastSessionId);
      channel.writeLine(JSON.stringify(usage, null, 2));
      return true;
    }

    case '/agent': {
      const nextAgent = args[0];
      if (!nextAgent) {
        channel.writeLine(`当前 Agent: ${replState.agentId}`);
        return true;
      }
      app.agentRegistry.get(nextAgent);
      replState.agentId = nextAgent;
      channel.writeLine(`当前 Agent 已切换为 ${nextAgent}`);
      return true;
    }

    case '/model': {
      if (args.length === 0) {
        const current = await resolveRouteSummary(
          app,
          replState.agentId,
          replState.providerOverride,
          replState.modelOverride,
          DEFAULT_TASK,
        );
        channel.writeLine(formatModelOutput('session', current).trimEnd());
        return true;
      }
      const provider = args[0]!;
      const model = args[1];
      await assertProviderAndModel(app.providerRegistry, provider, model);
      replState.providerOverride = provider;
      replState.modelOverride = model;
      channel.writeLine(`本 REPL 会话已切换到 ${provider}${model ? `/${model}` : ''}`);
      return true;
    }

    default:
      return false;
  }
}

async function resolveRouteSummary(
  app: AppContext,
  agentId: string,
  providerOverride: string | undefined,
  modelOverride: string | undefined,
  task: string,
): Promise<{ provider: string; model: string }> {
  const agent = app.agentRegistry.get(agentId);
  const selection = await resolveSelection({
    task,
    agent,
    providerRegistry: app.providerRegistry,
    root: app.opts.root,
    projectRoot: app.opts.projectRoot,
    config: app.loaded.config,
  });

  const provider = providerOverride ?? selection.primary.provider;
  let model = modelOverride ?? selection.primary.model;

  if (providerOverride && !modelOverride) {
    const providerEntry = app.providerRegistry.get(providerOverride) as AgentProvider & {
      listModels?: () => Promise<readonly { id: string }[]>;
    };
    if (typeof providerEntry.listModels === 'function') {
      const models = await providerEntry.listModels();
      if (models.length > 0) {
        model = models[0]!.id;
      }
    }
  }

  return { provider, model };
}

async function assertProviderAndModel(
  registry: ProviderRegistry,
  providerId: string,
  modelId?: string,
): Promise<void> {
  const provider = registry.get(providerId) as AgentProvider & {
    listModels?: () => Promise<readonly { id: string }[]>;
  };
  if (!modelId || typeof provider.listModels !== 'function') return;
  const models = await provider.listModels();
  if (!models.some((item) => item.id === modelId)) {
    throw new CommanderExit(1, `Provider '${providerId}' does not expose model '${modelId}'`);
  }
}

function readCliState(root: string): CliState {
  const file = join(root, 'channels', 'cli', CLI_CHANNEL_STATE_FILE);
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')) as CliState;
}

function writeCliChannelState(root: string, state: CliState): void {
  const dir = join(root, 'channels', 'cli');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, CLI_CHANNEL_STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function createDefaultProviderRegistry(config: LoadedConfig['config']): Promise<ProviderRegistry> {
  const registry = new ProviderRegistry();
  registry.register(createCodexProvider(config.providers?.codex ?? {}));
  return registry;
}

async function runDoctor(app: AppContext): Promise<Record<string, unknown>> {
  const providerChecks = await Promise.all(
    app.providerRegistry.list().map(async (provider) => ({
      id: provider.id,
      healthy: await provider.healthCheck(),
    })),
  );
  const dirChecks = await Promise.all(
    Object.entries(app.paths.dirs).map(async ([name, path]) => ({
      name,
      path,
      writable: await isWritable(path),
    })),
  );

  let sqliteOk = true;
  let sqliteError: string | undefined;
  try {
    haroDb.initHaroDatabase({ root: app.opts.root, dbFile: app.paths.dbFile });
  } catch (err) {
    sqliteOk = false;
    sqliteError = err instanceof Error ? err.message : String(err);
  }

  const ok =
    providerChecks.every((item) => item.healthy) &&
    dirChecks.every((item) => item.writable) &&
    sqliteOk;

  return {
    ok,
    config: { ok: true, sources: app.loaded.sources },
    providers: providerChecks,
    dataDir: { root: app.paths.root, checks: dirChecks },
    sqlite: {
      ok: sqliteOk,
      ...(sqliteError ? { error: sqliteError } : {}),
    },
  };
}

function readStatus(root: string, dbFile: string): Record<string, unknown> {
  const opened = haroDb.initHaroDatabase({ root, dbFile, keepOpen: true });
  const db = opened.database!;
  try {
    const sessions = db
      .prepare(
        'SELECT status, COUNT(*) AS count FROM sessions GROUP BY status ORDER BY status',
      )
      .all() as Array<{ status: string; count: number }>;
    const recent = db
      .prepare(
        'SELECT id, agent_id, provider, model, status, started_at, ended_at FROM sessions ORDER BY started_at DESC LIMIT 5',
      )
      .all();
    return { sessions, recent };
  } finally {
    db.close();
  }
}

function readUsage(root: string, dbFile: string, sessionId?: string): Record<string, unknown> {
  const opened = haroDb.initHaroDatabase({ root, dbFile, keepOpen: true });
  const db = opened.database!;
  try {
    const totalSessions = db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as {
      count: number;
    };
    const totalEvents = db.prepare('SELECT COUNT(*) AS count FROM session_events').get() as {
      count: number;
    };
    const currentSessionEvents = sessionId
      ? (
          db.prepare('SELECT COUNT(*) AS count FROM session_events WHERE session_id = ?').get(
            sessionId,
          ) as { count: number }
        ).count
      : 0;
    return {
      totalSessions: totalSessions.count,
      totalEvents: totalEvents.count,
      ...(sessionId ? { sessionId, currentSessionEvents } : {}),
    };
  } finally {
    db.close();
  }
}

function buildLogger(root?: string): CliLogger {
  return createLogger({
    root,
    name: 'cli.runtime',
  });
}

function inferAction(argv: readonly string[]): RunCliAction {
  if (argv.length === 0) return 'repl';
  const first = argv[0];
  if (first === 'run' || first === 'model' || first === 'config' || first === 'doctor' || first === 'status') {
    return first;
  }
  if (first === 'help' || first === '--help') {
    return 'help';
  }
  return 'repl';
}

function commandResult(
  app: AppContext,
  action: RunCliAction,
  exitCode: number,
  error?: Error,
): RunCliResult {
  return {
    exitCode,
    action,
    paths: app.paths,
    createdDirs: app.createdDirs,
    ...(error ? { error } : {}),
  };
}

function formatModelOutput(scope: 'current' | 'session', value: { provider: string; model: string }): string {
  const prefix = scope === 'current' ? '当前' : '会话';
  return `${prefix} Provider/Model: ${value.provider}/${value.model}\n`;
}

function defaultChannelFactory(input: {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadableStream;
  startRepl: boolean;
  now: () => Date;
  createConversationId?: () => string;
  onLocalCommand?: (line: string, channel: CliChannel) => Promise<boolean>;
}): CliChannel {
  return new CliChannel({
    output: input.stdout,
    error: input.stderr,
    input: input.stdin,
    startRepl: input.startRepl,
    now: input.now,
    sessionIdFactory: input.createConversationId,
    onLocalCommand: input.onLocalCommand,
  });
}

async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export {
  ChannelRegistry,
  CliChannel,
  type CliState,
  type InboundMessage,
  type MessageChannel,
};
