import {
  buildHaroPaths,
  createLogger,
  HaroPaths,
  config as haroConfig,
  fs as haroFs,
  LoggerOptions,
} from '@haro/core';

const VERSION = '0.0.0';

export interface RunCliOptions {
  argv?: readonly string[];
  root?: string;
  /** Optional project root (searched for `.haro/config.yaml`). */
  projectRoot?: string;
  stderr?: NodeJS.WritableStream;
}

export type RunCliAction = 'version' | 'bootstrap' | 'help' | 'config-error';

export interface RunCliResult {
  exitCode: number;
  action: RunCliAction;
  paths: HaroPaths;
  createdDirs: string[];
  /** Populated on config-error outcomes so callers can inspect issues. */
  error?: Error;
}

/**
 * Phase-0 CLI placeholder. Real commands arrive in FEAT-006. This entry exists
 * so AC1 (`pnpm build`) compiles a `cli` package, AC2 (invalid global config
 * causes immediate non-zero exit with Zod path in stderr), and AC5 (first run
 * creates the 7 data subdirectories) have a testable surface.
 */
export function runCli(opts: RunCliOptions = {}): RunCliResult {
  const argv = opts.argv ?? process.argv.slice(2);
  const paths = buildHaroPaths(opts.root);
  const stderr = opts.stderr ?? process.stderr;

  if (argv.includes('--version') || argv[0] === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return { exitCode: 0, action: 'version', paths, createdDirs: [] };
  }

  if (argv.includes('--help') || argv[0] === 'help') {
    process.stdout.write(
      [
        `haro ${VERSION} — self-evolving multi-agent platform (Phase 0 scaffold)`,
        '',
        'Usage:',
        '  haro              Load config, ensure ~/.haro data directories exist',
        '  haro --version    Print CLI version',
        '  haro --help       Show this help',
        '',
        'Full command surface (run / model / config / doctor / ...) lands in later FEAT specs.',
        '',
      ].join('\n'),
    );
    return { exitCode: 0, action: 'help', paths, createdDirs: [] };
  }

  let loaded: haroConfig.LoadedConfig;
  try {
    loaded = haroConfig.loadHaroConfig({
      globalRoot: opts.root,
      projectRoot: opts.projectRoot,
    });
  } catch (err) {
    if (err instanceof haroConfig.HaroConfigValidationError) {
      stderr.write(`${err.message}\n`);
      return { exitCode: 1, action: 'config-error', paths, createdDirs: [], error: err };
    }
    throw err;
  }

  const dirResult = haroFs.ensureHaroDirectories(opts.root);
  const loggerOpts: LoggerOptions = {
    root: opts.root,
    name: 'cli.bootstrap',
    level: loaded.config.logging?.level,
    stdout: loaded.config.logging?.stdout,
    file: loaded.config.logging?.file ?? undefined,
  };
  const logger = createLogger(loggerOpts);
  logger.info(
    {
      root: dirResult.root,
      created: dirResult.created.length,
      existed: dirResult.existed.length,
      configSources: loaded.sources,
    },
    'haro data directories ready',
  );

  return {
    exitCode: 0,
    action: 'bootstrap',
    paths,
    createdDirs: dirResult.created,
  };
}
