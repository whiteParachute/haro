import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import { stringify as stringifyYaml } from 'yaml';
import {
  AgentRegistry,
  AgentRunner,
  CheckpointStore,
  DEFAULT_AGENT_ID,
  ProviderRegistry,
  ScenarioRouter,
  TeamOrchestrator,
  buildHaroPaths,
  createMemoryFabric,
  createLogger,
  db as haroDb,
  fs as haroFs,
  loadAgentsFromDir,
  resolveSelection,
  type HaroLogger,
  type HaroPaths,
  type RawContextRef,
  type RoutingDecision,
  type RunAgentInput,
  type RunAgentResult,
  type ScenarioWorkflow,
  type TeamWorkflowExecutionResult,
} from '@haro/core';
import { createCodexProvider } from '@haro/provider-codex';
import {
  SkillsManager,
  type RuntimeSkillSyncItem,
  type RuntimeSkillSyncRuntime,
  type RuntimeSkillSyncSkill,
} from '@haro/skills';
import * as haroConfig from '@haro/core/config';
import type { HaroConfig, LoadedConfig } from '@haro/core/config';
import type { AgentEvent, AgentProvider } from '@haro/core/provider';
import {
  ChannelRegistry,
  CliChannel,
  type ChannelRegistration,
  type ChannelSetupContext,
  type InboundMessage,
  type MessageChannel,
} from './channel.js';
import { runSetup, type SetupRunDeps } from './setup.js';

const VERSION = '0.1.0';
const CLI_CHANNEL_STATE_FILE = 'state.json';
const DEFAULT_TASK = '列出当前目录下的 TypeScript 文件';

type CliLogger = Pick<HaroLogger, 'debug' | 'info' | 'warn' | 'error'>;
type MemoryWrapupHook = NonNullable<ConstructorParameters<typeof AgentRunner>[0]['memoryWrapupHook']>;

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
    memoryWrapupHook: MemoryWrapupHook;
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
  createAdditionalChannels?: (input: {
    root: string;
    loadedConfig: LoadedConfig['config'];
    logger: CliLogger;
    createSessionId?: () => string;
    argv?: readonly string[];
  }) => Promise<readonly ChannelRegistration[]>;
  setupDeps?: SetupRunDeps;
  fetchLatestNpmVersion?: (pkg: string) => Promise<string>;
}

export type RunCliAction =
  | 'version'
  | 'help'
  | 'run'
  | 'repl'
  | 'setup'
  | 'model'
  | 'config'
  | 'doctor'
  | 'status'
  | 'channel'
  | 'skills'
  | 'eat'
  | 'shit'
  | 'gateway'
  | 'web'
  | 'update'
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
  channelSessionId?: string;
  channelId?: string;
}

export interface AppContext {
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
  createRunner(createSessionId?: () => string): AgentRunner;
  router: ScenarioRouter;
  checkpointStore: CheckpointStore;
  createdDirs: string[];
  cliChannel: CliChannel;
  replState?: ReplState;
  skills: SkillsManager;
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

  if (argv[0] === 'update') {
    const checkOnly = argv.includes('--check');
    const result = await runUpdate({
      current: VERSION,
      pkg: '@haro/cli',
      checkOnly,
      stdout,
      fetchLatest: opts.fetchLatestNpmVersion ?? defaultFetchLatestNpmVersion,
    });
    stdout.write(result.message);
    return { exitCode: result.exitCode, action: 'update', paths, createdDirs: [] };
  }

  const bootstrap = await bootstrapApp({ ...opts, argv, stdout, stderr, stdin });
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
    app.checkpointStore.close();
    app.skills.close();
    return commandResult(app, inferAction(argv), 0);
  } catch (err) {
    await app.channelRegistry.stop();
    app.checkpointStore.close();
    app.skills.close();
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
    .configureOutput({
      writeOut: (str: string) => app.stdout.write(str),
      writeErr: (str: string) => app.stderr.write(str),
    })
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
    'setup',
    (cmd) => {
      cmd.alias('onboard').action(async () => {
        const report = await runSetup({
          paths: app.paths,
          loaded: app.loaded,
          providerRegistry: app.providerRegistry,
          deps: app.opts.setupDeps,
        });
        app.stdout.write(report.text);
        if (!report.ok) {
          throw new CommanderExit(1, 'setup found blockers');
        }
      });
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

  registerChannelCommands(program, app);
  registerSkillsCommands(program, app);
  registerMetabolismCommands(program, app);
  registerGatewayCommands(program, app);
  registerWebCommand(program, app);
  registerUpdateCommand(program, app);

  return program;
}

function registerChannelCommands(program: Command, app: AppContext): void {
  registerCommand(
    'channel',
    (cmd) => {
      cmd.description('Manage registered channels');

      cmd
        .command('list')
        .action(async () => {
          const lines = app.channelRegistry.list().map((entry) => {
            const caps = entry.channel.capabilities();
            return [
              entry.id,
              entry.enabled ? 'enabled' : 'disabled',
              entry.source,
              `streaming=${caps.streaming}`,
              `attachments=${caps.attachments}`,
            ].join('\t');
          });
          app.stdout.write(`${lines.join('\n')}\n`);
        });

      cmd
        .command('enable')
        .argument('<id>', 'channel id')
        .action(async (id: string) => {
          const entry = app.channelRegistry.enable(id);
          updateChannelConfig(app, id, { enabled: true });
          app.stdout.write(`Channel '${entry.id}' enabled\n`);
        });

      cmd
        .command('disable')
        .argument('<id>', 'channel id')
        .action(async (id: string) => {
          const entry = app.channelRegistry.disable(id);
          await entry.channel.stop();
          updateChannelConfig(app, id, { enabled: false });
          app.stdout.write(`Channel '${entry.id}' disabled\n`);
        });

      cmd
        .command('remove')
        .argument('<id>', 'channel id')
        .action(async (id: string) => {
          const entry = app.channelRegistry.getEntry(id);
          await entry.channel.stop();
          app.channelRegistry.remove(id);
          removeChannelConfig(app, id);
          rmSync(join(app.paths.dirs.channels, id), { recursive: true, force: true });
          app.stdout.write(`Channel '${entry.id}' removed\n`);
        });

      cmd
        .command('doctor')
        .argument('<id>', 'channel id')
        .action(async (id: string) => {
          const entry = app.channelRegistry.getEntry(id);
          const context = createChannelSetupContext(app, id);
          const report =
            typeof entry.channel.doctor === 'function'
              ? await entry.channel.doctor(context)
              : await fallbackChannelDoctor(entry.channel);
          app.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
          if (!report.ok) {
            throw new CommanderExit(1, report.message);
          }
        });

      cmd
        .command('setup')
        .argument('<id>', 'channel id')
        .action(async (id: string) => {
          const entry = app.channelRegistry.getEntry(id);
          if (typeof entry.channel.setup !== 'function') {
            throw new CommanderExit(1, `Channel '${id}' does not provide setup()`);
          }
          const result = await entry.channel.setup(createChannelSetupContext(app, id));
          if (!result.ok) {
            throw new CommanderExit(1, result.message);
          }
          updateChannelConfig(app, id, { ...result.config, enabled: true });
          app.channelRegistry.enable(id);
          app.stdout.write(`${result.message}\n`);
        });
    },
    program,
  );
}

function registerSkillsCommands(program: Command, app: AppContext): void {
  registerCommand(
    'skills',
    (cmd) => {
      cmd.description('Manage installed skills');

      cmd.command('list').action(async () => {
        const rows = app.skills.list().map((entry) =>
          [entry.id, entry.enabled ? 'enabled' : 'disabled', entry.source, entry.isPreinstalled ? 'preinstalled' : 'user'].join('\t'),
        );
        app.stdout.write(`${rows.join('\n')}\n`);
      });

      cmd.command('info').argument('<id>', 'skill id').action(async (id: string) => {
        let info;
        try {
          info = app.skills.info(id);
        } catch (error) {
          throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
        }
        const payload = {
          id: info.id,
          source: info.source,
          pinnedCommit: info.pinnedCommit,
          license: info.license,
          description: info.descriptor.description,
          enabled: info.enabled,
          ...(info.resolvedFrom ? { resolvedFrom: info.resolvedFrom } : {}),
        };
        app.stdout.write(
          `${JSON.stringify(payload, null, 2)}\n`,
        );
      });

      cmd.command('install').argument('<source>', 'git url / local path / marketplace:name').action(async (source: string) => {
        let entry;
        try {
          entry = app.skills.install(source);
        } catch (error) {
          throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
        }
        app.stdout.write(`Installed skill '${entry.id}' from ${entry.originalSource}\n`);
      });

      cmd.command('uninstall').argument('<id>', 'skill id').action(async (id: string) => {
        let entry;
        try {
          entry = app.skills.uninstall(id);
        } catch (error) {
          throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
        }
        app.stdout.write(`Uninstalled skill '${entry.id}'\n`);
      });

      cmd.command('enable').argument('<id>', 'skill id').action(async (id: string) => {
        let entry;
        try {
          entry = app.skills.enable(id);
        } catch (error) {
          throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
        }
        app.stdout.write(`Enabled skill '${entry.id}'\n`);
      });

      cmd.command('disable').argument('<id>', 'skill id').action(async (id: string) => {
        let entry;
        try {
          entry = app.skills.disable(id);
        } catch (error) {
          throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
        }
        app.stdout.write(`Disabled skill '${entry.id}'\n`);
      });

      cmd
        .command('sync-runtime')
        .description('Sync canonical preinstalled skills to Codex / Claude Code runtime homes')
        .option('--skill <skill>', 'shit|eat|metabolism', 'metabolism')
        .option('--runtime <runtime>', 'codex|claude|codex,claude', 'codex,claude')
        .option('--codex-home <path>', 'override CODEX_HOME for this sync')
        .option('--claude-home <path>', 'override CLAUDE_HOME for this sync')
        .option('--overwrite', 'overwrite conflicting runtime skills after preserving a backup')
        .action(
          async (options: {
            skill: string;
            runtime: string;
            codexHome?: string;
            claudeHome?: string;
            overwrite?: boolean;
          }) => {
            const skill = parseRuntimeSyncSkill(options.skill);
            const runtimes = parseRuntimeSyncRuntimes(options.runtime);
            const homes = {
              ...(options.codexHome ? { codex: options.codexHome } : {}),
              ...(options.claudeHome ? { claude: options.claudeHome } : {}),
            };
            const result = app.skills.syncRuntimeSkills({
              skill,
              runtimes,
              homes,
              overwrite: options.overwrite,
            });
            for (const item of result.items) {
              app.stdout.write(formatRuntimeSyncItem(item));
            }
            if (result.hasConflicts) {
              throw new CommanderExit(1, 'Runtime skill sync has conflicts; rerun with --overwrite after reviewing the target paths.');
            }
          },
        );
    },
    program,
  );
}

function parseRuntimeSyncSkill(value: string): RuntimeSkillSyncSkill {
  if (value === 'shit' || value === 'eat' || value === 'metabolism') {
    return value;
  }
  throw new CommanderExit(1, `Invalid runtime skill '${value}'. Expected one of: shit, eat, metabolism.`);
}

function parseRuntimeSyncRuntimes(value: string): RuntimeSkillSyncRuntime[] {
  const runtimes = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (runtimes.length === 0) {
    throw new CommanderExit(1, 'At least one runtime is required.');
  }
  const invalid = runtimes.filter((runtime) => runtime !== 'codex' && runtime !== 'claude');
  if (invalid.length > 0) {
    throw new CommanderExit(1, `Invalid runtime '${invalid.join(',')}'. Expected codex, claude, or codex,claude.`);
  }
  return [...new Set(runtimes)] as RuntimeSkillSyncRuntime[];
}

function formatRuntimeSyncItem(item: RuntimeSkillSyncItem): string {
  const columns = [`runtime=${item.runtime}`, `skill=${item.skillId}`, `status=${item.status}`, `targetPath=${item.targetPath}`];
  if (item.backupPath) {
    columns.push(`backupPath=${item.backupPath}`);
  }
  if (item.message) {
    columns.push(`message=${item.message}`);
  }
  return `${columns.join('\t')}\n`;
}

function registerMetabolismCommands(program: Command, app: AppContext): void {
  registerCommand(
    'eat',
    (cmd) => {
      cmd
        .argument('<input>', 'url | path | text')
        .option('--yes', 'skip confirmation')
        .option('--as <kind>', 'force input kind')
        .option('--deep', 'expand GitHub/path loading')
        .action(async (value: string, options: { yes?: boolean; as?: 'url' | 'path' | 'text'; deep?: boolean }) => {
          const result = await app.skills.invokeCommandSkill('eat', {
            input: value,
            yes: options.yes,
            as: options.as,
            deep: options.deep,
            stdin: app.stdin,
            stdout: app.stdout,
          });
          app.stdout.write(`${result.output}\n`);
        });
    },
    program,
  );

  registerCommand(
    'shit',
    (cmd) => {
      cmd
        .option('--scope <scope>', 'rules|skills|mcp|memory|all')
        .option('--days <n>', 'staleness window in days', (value) => Number.parseInt(value, 10))
        .option('--dry-run', 'preview candidates only')
        .option('--confirm-high', 'allow high-risk items')
        .action(async (options: { scope?: 'rules' | 'skills' | 'mcp' | 'memory' | 'all'; days?: number; dryRun?: boolean; confirmHigh?: boolean }) => {
          const result = await app.skills.invokeCommandSkill('shit', {
            scope: options.scope,
            days: options.days,
            dryRun: options.dryRun,
            confirmHigh: options.confirmHigh,
          });
          app.stdout.write(`${result.output}\n`);
        });

      cmd
        .command('rollback')
        .argument('<archiveId>', 'archive id')
        .option('--item <path>', 'restore a single archived item')
        .action(async (archiveId: string, options: { item?: string }) => {
          const result = await app.skills.invokeCommandSkill('shit', {
            archiveId,
            item: options.item,
          });
          app.stdout.write(`${result.output}\n`);
        });
    },
    program,
  );
}

function registerGatewayCommands(program: Command, app: AppContext): void {
  registerCommand(
    'gateway',
    (cmd) => {
      cmd.description('Gateway / daemon control for background channels');

      cmd
        .command('start')
        .option('-d, --daemon', 'run in background')
        .action(async (options: { daemon?: boolean }) => {
          const { gatewayStart } = await import('./gateway.js');
          const result = await gatewayStart(app, { daemon: options.daemon });
          app.stdout.write(result.output);
          if (result.exitCode !== 0) {
            throw new CommanderExit(result.exitCode, result.output.trim());
          }
        });

      cmd
        .command('stop')
        .action(async () => {
          const { gatewayStop } = await import('./gateway.js');
          const result = gatewayStop({ root: app.paths.root });
          app.stdout.write(result.output);
          if (result.exitCode !== 0) {
            throw new CommanderExit(result.exitCode, result.output.trim());
          }
        });

      cmd
        .command('status')
        .action(async () => {
          const { gatewayStatus } = await import('./gateway.js');
          const result = await gatewayStatus(app);
          app.stdout.write(result.output);
        });

      cmd
        .command('doctor')
        .action(async () => {
          const { gatewayDoctor } = await import('./gateway.js');
          const result = await gatewayDoctor(app);
          app.stdout.write(result.output);
          if (result.exitCode !== 0) {
            throw new CommanderExit(result.exitCode, 'gateway doctor found issues');
          }
        });
    },
    program,
  );
}

function registerUpdateCommand(program: Command, app: AppContext): void {
  registerCommand(
    'update',
    (cmd) => {
      cmd.description('Check for updates to Haro CLI').option('--check', 'preview only, do not prompt install').action(async (options: { check?: boolean }) => {
        const result = await runUpdate({
          current: VERSION,
          pkg: '@haro/cli',
          checkOnly: options.check ?? false,
          stdout: app.stdout,
          fetchLatest: app.opts.fetchLatestNpmVersion ?? defaultFetchLatestNpmVersion,
        });
        app.stdout.write(result.message);
        if (result.exitCode !== 0) {
          throw new CommanderExit(result.exitCode, result.message);
        }
      });
    },
    program,
  );
}

function registerWebCommand(program: Command, app: AppContext): void {
  registerCommand(
    'web',
    (cmd) => {
      cmd
        .description('Start Haro web dashboard')
        .option('--port <port>', 'HTTP port', '3456')
        .option('--host <host>', 'bind address', '127.0.0.1')
        .action(async (options: { port: string; host: string }) => {
          const port = parseWebPort(options.port);
          const [{ createWebApp }, { startWebServer }] = await Promise.all([
            import('./web/index.js'),
            import('./web/server.js'),
          ]);
          const handle = startWebServer(
            createWebApp({
              runtime: {
                agentRegistry: app.agentRegistry,
                createRunner: app.createRunner,
                root: app.opts.root,
                dbFile: app.paths.dbFile,
              },
            }),
            { port, host: options.host },
          );
          await handle.ready;
          app.stdout.write(`Haro web dashboard listening on ${handle.url}\n`);
        });
    },
    program,
  );
}

function parseWebPort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || String(port) !== value || port < 1 || port > 65_535) {
    throw new CommanderExit(1, `Invalid web port: ${value}`);
  }
  return port;
}

async function defaultFetchLatestNpmVersion(pkg: string): Promise<string> {
  let registry = process.env.NPM_CONFIG_REGISTRY?.replace(/\/$/, '') ?? '';
  if (!registry) {
    try {
      const result = spawnSync('npm', ['config', 'get', 'registry'], { encoding: 'utf8' });
      if (result.status === 0) {
        const configured = result.stdout.trim();
        if (configured) {
          registry = configured.replace(/\/$/, '');
        }
      }
    } catch {
      // fallback to default
    }
  }
  if (!registry) {
    registry = 'https://registry.npmjs.org';
  }
  const res = await fetch(`${registry}/${pkg}/latest`);
  if (!res.ok) {
    throw new Error(`npm registry returned ${res.status}`);
  }
  const data = (await res.json()) as { version: string };
  return data.version;
}

interface UpdateResult {
  exitCode: number;
  message: string;
}

async function runUpdate(input: {
  current: string;
  pkg: string;
  checkOnly: boolean;
  stdout: NodeJS.WritableStream;
  fetchLatest: (pkg: string) => Promise<string>;
}): Promise<UpdateResult> {
  let latest: string;
  try {
    latest = await input.fetchLatest(input.pkg);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      message: `无法检查更新：${msg}\n`,
    };
  }

  const cmp = compareSemver(input.current, latest);
  if (cmp === 0) {
    return {
      exitCode: 0,
      message: `当前已是最新版本 ${input.current}\n`,
    };
  }
  if (cmp > 0) {
    return {
      exitCode: 0,
      message: `当前版本 ${input.current} 高于 registry 版本 ${latest}\n`,
    };
  }

  const action = input.checkOnly
    ? `发现新版本：${input.current} → ${latest}\n升级命令：npm install -g ${input.pkg}@latest\n`
    : `发现新版本：${input.current} → ${latest}\n请运行：npm install -g ${input.pkg}@latest\n`;

  return { exitCode: 0, message: action };
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((n) => Number.parseInt(n, 10));
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < 3; i++) {
    const an = av[i] ?? 0;
    const bn = bv[i] ?? 0;
    if (an !== bn) return an > bn ? 1 : -1;
  }
  return 0;
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
  const skills = new SkillsManager({ root: paths.root });
  skills.ensureInitialized();
  const memoryWrapupHook = createCliMemoryWrapupHook(skills, logger);

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

  const createRunner = (createSessionId = input.createSessionId): AgentRunner =>
    input.createRunner
      ? input.createRunner({
          agentRegistry,
          providerRegistry,
          logger,
          root: input.root,
          projectRoot: input.projectRoot,
          createSessionId,
          memoryWrapupHook,
        })
      : new AgentRunner({
          agentRegistry,
          providerRegistry,
          root: input.root,
          projectRoot: input.projectRoot,
          createSessionId,
          logger,
          memoryWrapupHook,
        });
  const runner = createRunner();
  const router = new ScenarioRouter({
    createId: input.createSessionId,
    now,
  });
  const checkpointStore = new CheckpointStore({
    root: input.root,
    now,
  });

  const app = {
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
    createRunner,
    router,
    checkpointStore,
    skills,
    createdDirs: dirResult.created,
    cliChannel: undefined as unknown as CliChannel,
    replState: undefined,
  } satisfies AppContext;

  app.cliChannel = (input.channelFactory ?? defaultChannelFactory)({
    stdout: input.stdout,
    stderr: input.stderr,
    stdin: input.stdin,
    startRepl: true,
    now,
    createConversationId: input.createConversationId,
    onLocalCommand: async (line, channel) => {
      if (!app.replState) return false;
      return handleSlashCommand(app, app.replState, channel, line);
    },
  });
  app.channelRegistry.register({
    channel: app.cliChannel,
    enabled: loaded.config.channels?.cli?.enabled !== false,
    removable: false,
    source: 'builtin',
    displayName: 'CLI',
  });

  const additionalChannels = input.createAdditionalChannels
    ? await input.createAdditionalChannels({
        root: paths.root,
        loadedConfig: loaded.config,
        logger,
        createSessionId: input.createSessionId,
        argv: input.argv,
      })
    : await createDefaultAdditionalChannels({
        root: paths.root,
        loadedConfig: loaded.config,
        logger,
        createSessionId: input.createSessionId,
        argv: input.argv,
      });
  for (const registration of additionalChannels) {
    app.channelRegistry.register(registration);
  }

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
  app.replState = replState;
  await startEnabledBackgroundChannels(app);

  const route = await resolveRouteSummary(
    app,
    replState.agentId,
    replState.providerOverride,
    replState.modelOverride,
    DEFAULT_TASK,
  );
  await app.cliChannel.showBanner(route);
  await app.cliChannel.start({
    config: app.loaded.config.channels?.cli ?? {},
    logger: app.logger,
    onInbound: async (msg) => handleCliInbound(app, msg),
  });
}

async function handleCliInbound(app: AppContext, msg: InboundMessage): Promise<void> {
  const replState = app.replState;
  if (!replState) {
    throw new Error('CLI inbound handler requires an active REPL state');
  }
  const task = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
  const result = await executeTask(
    app,
    {
      task,
      agentId: replState.agentId,
      provider: replState.providerOverride,
      model: replState.modelOverride,
      continueLatestSession: replState.continueLatestSession,
      channelSessionId: msg.sessionId,
      channelId: msg.channelId,
    },
    app.cliChannel,
  );
  replState.lastUserTask = task;
  replState.lastSessionId = result.sessionId;
  replState.continueLatestSession = true;
}

async function handleExternalInbound(app: AppContext, channel: MessageChannel, msg: InboundMessage): Promise<void> {
  const task = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
  await executeTask(
    app,
    {
      task,
      agentId: app.cliState.defaultAgentId ?? app.loaded.config.defaultAgent ?? DEFAULT_AGENT_ID,
      provider: app.cliState.defaultProvider,
      model: app.cliState.defaultModel,
      channelSessionId: msg.sessionId,
      channelId: msg.channelId,
    },
    channel,
  );
}

async function executeTask(
  app: AppContext,
  input: ExecutionOptions,
  channel?: MessageChannel,
) {
  app.agentRegistry.get(input.agentId);
  const prepared = await app.skills.prepareTask(input.task, { agentId: input.agentId });
  const effectiveTask = prepared.finalTask ?? input.task;
  const channelSessionId = input.channelSessionId ?? resolveIngressSessionId(app);
  const outputChannel =
    channel ??
    (app.opts.channelFactory ?? defaultChannelFactory)({
      stdout: app.stdout,
      stderr: app.stderr,
      stdin: app.stdin,
      startRepl: false,
      now: app.now,
      createConversationId: () => channelSessionId,
    });
  if (!channel) {
    await outputChannel.start({
      config: {},
      logger: app.logger,
      onInbound: async () => undefined,
    });
  }
  if (prepared.directOutput) {
    await outputChannel.send(input.retryOfSessionId ?? 'skill-direct', {
      type: 'text',
      content: prepared.directOutput,
    });
    return {
      sessionId: input.retryOfSessionId ?? 'skill-direct',
      ruleId: 'skill-direct',
      provider: input.provider ?? 'skill-runtime',
      model: input.model ?? 'skill-runtime',
      events: [],
      finalEvent: {
        type: 'result' as const,
        content: prepared.directOutput,
      },
    };
  }

  let liveDispatch = Promise.resolve();
  const queueLiveEvent = (event: AgentEvent, sessionId: string): void => {
    if (event.type !== 'text' || event.delta !== true) return;
    if (!outputChannel.capabilities().streaming) return;
    liveDispatch = liveDispatch.then(() =>
      outputChannel.send(sessionId, {
        type: 'text',
        content: event.content,
        delta: true,
      }),
    );
  };
  const scene = app.router.classify(effectiveTask);
  const decision = app.router.route(scene);
  const workflow = app.router.createWorkflow(decision, {
    sceneDescriptor: scene,
    channelSessionId,
  });
  const rawContextRefs = [
    {
      kind: 'input' as const,
      ref: buildIngressContextRef(input.channelId ?? outputChannel.id, channelSessionId),
    },
  ];
  if (decision.executionMode === 'team') {
    const teamResult = await executeTeamWorkflow(app, input, workflow, decision, rawContextRefs);
    await outputChannel.send(teamResult.sessionId, {
      type: 'text',
      content:
        teamResult.finalEvent.type === 'result'
          ? teamResult.finalEvent.content
          : `ERROR [${teamResult.finalEvent.code}] ${teamResult.finalEvent.message}`,
    });
    return teamResult;
  }
  const checkpointNodeId = workflow.leafSessionRefs[0]?.nodeId ?? 'leaf-1';
  const leafSessionId =
    workflow.leafSessionRefs[0]?.sessionId ??
    (app.opts.createSessionId ? app.opts.createSessionId() : randomUUID());
  const branchState = { fallbackExecutionMode: null };
  const runner = app.createRunner(() => leafSessionId);
  const result = await runner.run({
    task: effectiveTask,
    agentId: input.agentId,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.noMemory ? { noMemory: true } : {}),
    ...(input.retryOfSessionId ? { retryOfSessionId: input.retryOfSessionId } : {}),
    ...(input.continueLatestSession === false ? { continueLatestSession: false } : {}),
    onEvent: queueLiveEvent,
  });
  await liveDispatch;
  app.checkpointStore.save({
    workflowId: workflow.workflowId,
    nodeId: checkpointNodeId,
    state: {
      workflowId: workflow.workflowId,
      nodeId: checkpointNodeId,
      nodeType: 'agent',
      sceneDescriptor: scene,
      routingDecision: decision,
      rawContextRefs,
      branchState,
      leafSessionRefs: [
        {
          nodeId: checkpointNodeId,
          sessionId: result.sessionId,
          ...(result.finalEvent.type === 'result' && result.finalEvent.responseId
            ? { providerResponseId: result.finalEvent.responseId }
            : {}),
        },
      ],
      createdAt: workflow.createdAt,
    },
  });

  for (const event of result.events) {
    if (event.type === 'text') {
      if (event.delta === true && outputChannel.capabilities().streaming) {
        continue;
      }
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

async function executeTeamWorkflow(
  app: AppContext,
  input: ExecutionOptions,
  workflow: ScenarioWorkflow,
  decision: RoutingDecision,
  rawContextRefs: RawContextRef[],
): Promise<RunAgentResult> {
  const runner = app.createRunner();
  const teamAgentRunner = {
    run: (branchInput: RunAgentInput) =>
      runner.run({
        ...branchInput,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.noMemory ? { noMemory: true } : {}),
      }),
  };
  const orchestrator = new TeamOrchestrator({
    agentRunner: teamAgentRunner,
    checkpointStore: app.checkpointStore,
    now: app.now,
    defaultAgentId: input.agentId,
  });

  try {
    const result = await orchestrator.executeWorkflow(workflow, decision, rawContextRefs);
    const content = formatTeamWorkflowResult(result);
    return {
      sessionId: workflow.workflowId,
      ruleId: decision.matchedRuleId ?? decision.workflowTemplateId,
      provider: input.provider ?? 'team-orchestrator',
      model: input.model ?? workflow.workflowTemplateId,
      events: [
        {
          type: 'result',
          content,
          responseId: result.envelope.checkpointRef,
        },
      ],
      finalEvent: {
        type: 'result',
        content,
        responseId: result.envelope.checkpointRef,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    app.logger.error?.(
      {
        workflowId: workflow.workflowId,
        workflowTemplateId: workflow.workflowTemplateId,
        orchestrationMode: workflow.orchestrationMode,
        err: message,
      },
      'Team workflow execution failed',
    );
    return {
      sessionId: workflow.workflowId,
      ruleId: decision.matchedRuleId ?? decision.workflowTemplateId,
      provider: input.provider ?? 'team-orchestrator',
      model: input.model ?? workflow.workflowTemplateId,
      events: [
        {
          type: 'error',
          code: 'team_workflow_failed',
          message,
          retryable: false,
        },
      ],
      finalEvent: {
        type: 'error',
        code: 'team_workflow_failed',
        message,
        retryable: false,
      },
    };
  }
}

function formatTeamWorkflowResult(result: TeamWorkflowExecutionResult): string {
  return JSON.stringify(
    {
      workflowId: result.workflow.workflowId,
      orchestrationMode: result.envelope.orchestrationMode,
      teamStatus: result.state.teamStatus,
      branchLedger: result.state.branches,
      mergeEnvelope: result.envelope,
    },
    null,
    2,
  );
}

function resolveIngressSessionId(app: AppContext): string {
  return app.opts.createConversationId ? app.opts.createConversationId() : randomUUID();
}

function buildIngressContextRef(channelId: string, channelSessionId: string): string {
  return `channel://${channelId}/sessions/${channelSessionId}`;
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
      channel.writeLine(
        app.skills
          .list()
          .map((entry) => `${entry.id}\t${entry.enabled ? 'enabled' : 'disabled'}\t${entry.source}`)
          .join('\n'),
      );
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

async function startEnabledBackgroundChannels(app: AppContext): Promise<void> {
  for (const entry of app.channelRegistry.listEnabled()) {
    if (entry.id === 'cli') continue;
    await entry.channel.start({
      config: readChannelConfig(app.loaded.config, entry.id),
      logger: app.logger,
      onInbound: async (msg) => handleExternalInbound(app, entry.channel, msg),
    });
  }
}

async function createDefaultAdditionalChannels(input: {
  root: string;
  loadedConfig: LoadedConfig['config'];
  logger: CliLogger;
  createSessionId?: () => string;
  argv?: readonly string[];
}): Promise<readonly ChannelRegistration[]> {
  const firstArg = input.argv?.[0];
  const registrations: ChannelRegistration[] = [];

  const feishuConfig = readChannelConfig({ channels: input.loadedConfig.channels }, 'feishu');
  if (firstArg === 'channel' || feishuConfig.enabled === true) {
    try {
      const { FeishuChannel } = await import('@haro/channel-feishu');
      registrations.push({
        channel: new FeishuChannel({
          root: input.root,
          logger: input.logger,
          config: feishuConfig,
          createSessionId: input.createSessionId,
        }),
        enabled: feishuConfig.enabled === true,
        removable: true,
        source: 'package',
        displayName: 'Feishu',
      });
    } catch (error) {
      input.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Optional channel package @haro/channel-feishu is unavailable; continuing without Feishu',
      );
    }
  }

  const telegramConfig = readChannelConfig({ channels: input.loadedConfig.channels }, 'telegram');
  if (firstArg === 'channel' || telegramConfig.enabled === true) {
    try {
      const { TelegramChannel } = await import('@haro/channel-telegram');
      registrations.push({
        channel: new TelegramChannel({
          root: input.root,
          logger: input.logger,
          config: telegramConfig,
          createSessionId: input.createSessionId,
        }),
        enabled: telegramConfig.enabled === true,
        removable: true,
        source: 'package',
        displayName: 'Telegram',
      });
    } catch (error) {
      input.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Optional channel package @haro/channel-telegram is unavailable; continuing without Telegram',
      );
    }
  }

  return registrations;
}

function readChannelConfig(config: { channels?: HaroConfig['channels'] }, id: string): Record<string, unknown> {
  const channels = (config.channels ?? {}) as Record<string, unknown>;
  const value = channels[id];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function updateChannelConfig(app: AppContext, id: string, patch: Record<string, unknown>): void {
  const channels = ((app.loaded.config.channels ??= {}) as Record<string, unknown>);
  const current = readChannelConfig(app.loaded.config, id);
  channels[id] = { ...current, ...patch };
  persistLoadedConfig(app);
}

function removeChannelConfig(app: AppContext, id: string): void {
  const channels = app.loaded.config.channels as Record<string, unknown> | undefined;
  if (channels && id in channels) {
    delete channels[id];
  }
  persistLoadedConfig(app);
}

function persistLoadedConfig(app: AppContext): void {
  writeFileSync(app.paths.configFile, stringifyYaml(app.loaded.config), 'utf8');
  if (!app.loaded.sources.includes(app.paths.configFile)) {
    app.loaded.sources.push(app.paths.configFile);
  }
}

function createChannelSetupContext(app: AppContext, id: string): ChannelSetupContext {
  return {
    root: app.paths.root,
    config: readChannelConfig(app.loaded.config, id),
    stdin: app.stdin,
    stdout: app.stdout,
    stderr: app.stderr,
    logger: app.logger,
  };
}

async function fallbackChannelDoctor(channel: MessageChannel): Promise<{
  ok: boolean;
  message: string;
}> {
  const ok = await channel.healthCheck();
  return { ok, message: ok ? 'healthy' : 'unhealthy' };
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
  const channelChecks = await Promise.all(
    app.channelRegistry
      .listEnabled()
      .filter((entry) => entry.source === 'package')
      .map(async (entry) => {
        try {
          return {
            id: entry.id,
            displayName: entry.displayName,
            source: entry.source,
            healthy: await entry.channel.healthCheck(),
          };
        } catch (err) {
          return {
            id: entry.id,
            displayName: entry.displayName,
            source: entry.source,
            healthy: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
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
    channelChecks.every((item) => item.healthy) &&
    dirChecks.every((item) => item.writable) &&
    sqliteOk;

  return {
    ok,
    config: { ok: true, sources: app.loaded.sources },
    providers: providerChecks,
    channels: channelChecks,
    dataDir: { root: app.paths.root, checks: dirChecks },
    sqlite: {
      ok: sqliteOk,
      ...(sqliteError ? { error: sqliteError } : {}),
    },
  };
}

function createCliMemoryWrapupHook(skills: SkillsManager, logger: CliLogger): MemoryWrapupHook {
  const memoryFabric = createMemoryFabric({ root: skills.paths.dirs.memory });
  return async ({ sessionId, agentId, task, result }) => {
    const enabled = skills.list().some((entry) => entry.id === 'memory-wrapup' && entry.enabled);
    if (!enabled) {
      logger.debug?.({ sessionId, agentId }, 'memory-wrapup skill disabled; skipping CLI memory wrapup');
      return;
    }
    try {
      await memoryFabric.wrapupSession({
        scope: 'agent',
        agentId,
        wrapupId: sessionId,
        topic: previewText(task),
        summary: previewText(result),
        transcript: [`Task: ${task}`, '', `Result: ${result}`].join('\n'),
        source: 'skill:memory-wrapup',
      });
    } catch (err) {
      logger.warn?.(
        { sessionId, agentId, err: err instanceof Error ? err.message : String(err) },
        'CLI memory-wrapup hook failed',
      );
    }
  };
}

function previewText(value: string, limit = 80): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
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
    stdout: false,
  });
}

function inferAction(argv: readonly string[]): RunCliAction {
  if (argv.length === 0) return 'repl';
  const first = argv[0];
  if (first === 'setup' || first === 'onboard') {
    return 'setup';
  }
  if (first === 'run' || first === 'model' || first === 'config' || first === 'doctor' || first === 'status' || first === 'channel' || first === 'skills' || first === 'eat' || first === 'shit' || first === 'gateway' || first === 'web' || first === 'update') {
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

if (require.main === module) {
  void runCli()
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}

export {
  ChannelRegistry,
  CliChannel,
  type CliState,
  type InboundMessage,
  type MessageChannel,
  handleExternalInbound,
  readChannelConfig,
};
