import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { HaroLogger } from '../logger/index.js';
import type { ProviderRegistry } from '../provider/index.js';
import { AgentRegistry, AgentIdConflictError } from './registry.js';
import {
  AgentSchemaValidationError,
  parseAgentConfig,
} from './schema.js';
import {
  AgentConfigResolutionError,
  resolveAgentDefaults,
} from './provider-resolver.js';
import { bootstrapDefaultAgentFile } from './bootstrap.js';
import type { AgentConfig } from './types.js';

/**
 * FEAT-004 R3 / R5 / R8 — directory scan loader.
 *
 * Hard rules pulled straight from the spec:
 *   • `id` in the YAML body MUST equal the filename (without extension).
 *   • Schema violations, id/filename mismatches, and duplicate ids are
 *     downgraded to `warn` and the offending file is skipped — the rest of
 *     the directory keeps loading (R5).
 *   • R8 validation (`defaultProvider` / `defaultModel` existence) runs for
 *     EVERY loaded Agent that declares those fields. The ProviderRegistry
 *     is optional only as a convenience for tests that load Agents with no
 *     routing metadata; the moment any loaded Agent sets `defaultProvider`
 *     or `defaultModel` without one, the loader throws `AgentConfigResolutionError`
 *     (kind: `missing-provider-registry`). R8 forbids silent downgrade.
 *
 * Caller contract: `~/.haro/agents/` is supposed to contain only Agent YAML
 * files. Sub-directories and non-`.yaml`/`.yml` files are quietly ignored
 * so a future `README.md` in that directory does not crash the loader.
 */
export interface LoadAgentsOptions {
  agentsDir: string;
  providerRegistry?: ProviderRegistry;
  logger?: Pick<HaroLogger, 'warn' | 'info' | 'error'>;
  registry?: AgentRegistry;
  /**
   * When true (default), create `haro-assistant.yaml` if the directory is
   * empty (R6). Tests that want to assert the "empty directory" branch
   * can pass `false`.
   */
  bootstrap?: boolean;
}

export interface LoadAgentsReport {
  registry: AgentRegistry;
  loaded: readonly string[];
  skipped: readonly { id?: string; file: string; reason: string }[];
  bootstrapped: boolean;
  bootstrapPath?: string;
}

const DEFAULT_BOOTSTRAP_FLAG = true;

const YAML_EXTS = new Set(['.yaml', '.yml']);

function resolveLogger(
  logger: LoadAgentsOptions['logger'],
): NonNullable<LoadAgentsOptions['logger']> {
  if (logger) return logger;
  return {
    warn: () => undefined,
    info: () => undefined,
    error: () => undefined,
  } as unknown as NonNullable<LoadAgentsOptions['logger']>;
}

export async function loadAgentsFromDir(
  opts: LoadAgentsOptions,
): Promise<LoadAgentsReport> {
  const {
    agentsDir,
    providerRegistry,
    bootstrap = DEFAULT_BOOTSTRAP_FLAG,
  } = opts;
  const log = resolveLogger(opts.logger);
  const registry = opts.registry ?? new AgentRegistry();

  let bootstrapped = false;
  let bootstrapPath: string | undefined;
  if (bootstrap) {
    const res = bootstrapDefaultAgentFile(agentsDir);
    bootstrapped = res.created;
    bootstrapPath = res.filePath;
    if (res.created) {
      log.info(
        { file: res.filePath },
        'Created default Agent haro-assistant.yaml (FEAT-004 R6)',
      );
    }
  } else if (!existsSync(agentsDir)) {
    return {
      registry,
      loaded: [],
      skipped: [],
      bootstrapped: false,
    };
  }

  const loaded: string[] = [];
  const skipped: { id?: string; file: string; reason: string }[] = [];

  const entries = existsSync(agentsDir) ? readdirSync(agentsDir) : [];
  for (const entry of entries.sort()) {
    const file = join(agentsDir, entry);
    const ext = extname(entry);
    if (!YAML_EXTS.has(ext)) continue;

    const cfg = loadOne(file, log);
    if (!cfg.ok) {
      skipped.push({ file, reason: cfg.reason, ...(cfg.id ? { id: cfg.id } : {}) });
      continue;
    }

    try {
      if (cfg.value.defaultProvider || cfg.value.defaultModel) {
        if (!providerRegistry) {
          throw new AgentConfigResolutionError(
            cfg.value.id,
            'missing-provider-registry',
            cfg.value.defaultProvider ?? cfg.value.defaultModel ?? '<unknown>',
            `Agent '${cfg.value.id}' sets defaultProvider/defaultModel but no providerRegistry was passed to loadAgentsFromDir() (FEAT-004 R8 — startup validation must not be skipped)`,
          );
        }
        await resolveAgentDefaults(cfg.value, providerRegistry);
      }
      registry.register(cfg.value);
      loaded.push(cfg.value.id);
    } catch (err) {
      if (err instanceof AgentIdConflictError) {
        log.warn(
          { file, id: err.id },
          `Duplicate Agent id '${err.id}' — skipping ${entry} (FEAT-004 R5)`,
        );
        skipped.push({ id: err.id, file, reason: `duplicate-id:${err.id}` });
        continue;
      }
      if (err instanceof AgentConfigResolutionError) {
        // R8 — fail loud by rethrowing; the loader does NOT catch these.
        throw err;
      }
      throw err;
    }
  }

  return {
    registry,
    loaded,
    skipped,
    bootstrapped,
    ...(bootstrapPath ? { bootstrapPath } : {}),
  };
}

interface OneOk {
  ok: true;
  value: AgentConfig;
}
interface OneErr {
  ok: false;
  reason: string;
  id?: string;
}

function loadOne(
  file: string,
  log: NonNullable<LoadAgentsOptions['logger']>,
): OneOk | OneErr {
  const fileBase = basename(file, extname(file));

  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    const reason = (err as Error).message;
    log.warn({ file }, `Failed to read Agent file: ${reason}`);
    return { ok: false, reason: `read-error:${reason}` };
  }

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    const reason = (err as Error).message;
    log.warn({ file }, `Invalid YAML in Agent file: ${reason}`);
    return { ok: false, reason: `yaml-error:${reason}` };
  }

  const parsed = parseAgentConfig(data);
  if (!parsed.ok) {
    const err: AgentSchemaValidationError = parsed.error;
    log.warn({ file, issues: err.issues }, err.message);
    const idHint =
      data && typeof data === 'object' && 'id' in data && typeof (data as { id: unknown }).id === 'string'
        ? ((data as { id: string }).id)
        : undefined;
    return { ok: false, reason: `schema-error:${err.message}`, ...(idHint ? { id: idHint } : {}) };
  }

  const cfg = parsed.config;
  if (cfg.id !== fileBase) {
    const reason = `id '${cfg.id}' does not match filename '${fileBase}'`;
    log.warn({ file, expected: fileBase, actual: cfg.id }, `Agent id/filename mismatch: ${reason} (FEAT-004 R3)`);
    return { ok: false, reason: `id-mismatch:${reason}`, id: cfg.id };
  }

  return { ok: true, value: cfg };
}
