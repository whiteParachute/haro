/** FEAT-004 integration loader — AC1 / AC2 / AC3 / AC4 / AC6 / AC7. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadAgentsFromDir,
  AgentConfigResolutionError,
  DEFAULT_AGENT_FILE,
  DEFAULT_AGENT_ID,
} from '../src/agent/index.js';
import { ProviderRegistry } from '../src/provider/index.js';
import type { AgentProvider, AgentQueryParams, AgentEvent } from '../src/provider/index.js';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'haro-agent-loader-'));
}

function captureLogger(): {
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warns: unknown[][];
  infos: unknown[][];
  errors: unknown[][];
} {
  const warns: unknown[][] = [];
  const infos: unknown[][] = [];
  const errors: unknown[][] = [];
  return {
    warn: (...a) => warns.push(a),
    info: (...a) => infos.push(a),
    error: (...a) => errors.push(a),
    warns,
    infos,
    errors,
  };
}

function write(dir: string, name: string, body: string): void {
  writeFileSync(join(dir, name), body, 'utf8');
}

describe('loadAgentsFromDir [FEAT-004]', () => {
  let dir: string;

  beforeEach(() => {
    dir = freshDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('AC1: loads a valid foo.yaml so registry.get("foo") returns it', async () => {
    write(dir, 'foo.yaml', 'id: foo\nname: Foo\nsystemPrompt: you are foo.\n');
    const logger = captureLogger();
    const { registry, loaded } = await loadAgentsFromDir({
      agentsDir: dir,
      logger,
      bootstrap: false,
    });
    expect(loaded).toContain('foo');
    expect(registry.get('foo')).toMatchObject({ id: 'foo', name: 'Foo' });
  });

  it('AC2: unknown field is warned and skipped; other agents still load', async () => {
    write(dir, 'ok.yaml', 'id: ok\nname: OK\nsystemPrompt: p\n');
    write(
      dir,
      'bar.yaml',
      'id: bar\nname: Bar\nsystemPrompt: p\nrole: engineer\n',
    );
    const logger = captureLogger();
    const { registry, loaded, skipped } = await loadAgentsFromDir({
      agentsDir: dir,
      logger,
      bootstrap: false,
    });
    expect(loaded).toEqual(['ok']);
    expect(registry.has('bar')).toBe(false);
    const skippedReasons = skipped.map((s) => s.reason).join('\n');
    expect(skippedReasons).toContain('Unknown field');
    const warnPayloads = JSON.stringify(logger.warns);
    expect(warnPayloads).toContain('Unknown field');
    expect(warnPayloads).toContain("Agent 的行为由 tools 决定");
  });

  it('AC3: duplicate id → second file warned & skipped', async () => {
    write(dir, 'alpha.yaml', 'id: alpha\nname: A\nsystemPrompt: p\n');
    // Second file with the same declared id BUT different filename (so the
    // id/filename check passes for neither — we rename to preserve the
    // declared id match on the first file only).
    // To simulate "two YAML files declare the same id" we place a copy whose
    // id matches its own filename but with a post-hoc rewrite:
    write(
      dir,
      'beta.yaml',
      'id: beta\nname: B1\nsystemPrompt: p\n',
    );
    // And a second 'alpha'-id file via a different filename to test the
    // duplicate branch.
    write(
      dir,
      'alpha-dup.yaml',
      'id: alpha-dup\nname: A2\nsystemPrompt: p\n',
    );
    // Swap in a duplicate id scenario by overwriting alpha-dup.yaml to
    // declare `id: alpha` — that hits BOTH id-mismatch and duplicate paths.
    // The loader's first filter is id/filename mismatch, so to force the
    // duplicate branch we drop a file named 'alpha.yml' (note extension) that
    // also declares id 'alpha'.
    write(dir, 'alpha.yml', 'id: alpha\nname: A_v2\nsystemPrompt: p\n');
    const logger = captureLogger();
    const { registry, loaded, skipped } = await loadAgentsFromDir({
      agentsDir: dir,
      logger,
      bootstrap: false,
    });
    // The .yaml file wins because sort() places 'alpha.yaml' before
    // 'alpha.yml'. The second file is reported as duplicate.
    expect(loaded).toContain('alpha');
    const duplicates = skipped.filter((s) => s.reason.startsWith('duplicate-id'));
    expect(duplicates.map((d) => d.id)).toContain('alpha');
    expect(registry.get('alpha').name).toBe('A'); // first wins
  });

  it('AC4: bootstraps haro-assistant.yaml into empty dir and loads it', async () => {
    const logger = captureLogger();
    const report = await loadAgentsFromDir({
      agentsDir: dir,
      logger,
    });
    expect(report.bootstrapped).toBe(true);
    expect(report.bootstrapPath).toBe(join(dir, DEFAULT_AGENT_FILE));
    expect(report.registry.get(DEFAULT_AGENT_ID)).toBeDefined();
    expect(readdirSync(dir)).toContain(DEFAULT_AGENT_FILE);
  });

  it('AC6: id/filename mismatch surfaces a clear warn and skips', async () => {
    write(dir, 'foo.yaml', 'id: bar\nname: Bar\nsystemPrompt: p\n');
    const logger = captureLogger();
    const { registry, skipped } = await loadAgentsFromDir({
      agentsDir: dir,
      logger,
      bootstrap: false,
    });
    expect(registry.has('foo')).toBe(false);
    expect(registry.has('bar')).toBe(false);
    const reasons = skipped.map((s) => s.reason).join('\n');
    expect(reasons).toContain("id 'bar' does not match filename 'foo'");
    const warnDump = JSON.stringify(logger.warns);
    expect(warnDump).toContain('Agent id/filename mismatch');
  });

  it('AC7: unknown defaultProvider throws with a clear detail', async () => {
    write(
      dir,
      'routed.yaml',
      'id: routed\nname: R\nsystemPrompt: p\ndefaultProvider: unknown-provider\n',
    );
    const logger = captureLogger();
    const providerRegistry = new ProviderRegistry();
    await expect(
      loadAgentsFromDir({
        agentsDir: dir,
        providerRegistry,
        logger,
        bootstrap: false,
      }),
    ).rejects.toBeInstanceOf(AgentConfigResolutionError);
  });

  it('AC7: unknown defaultModel throws with a clear detail', async () => {
    write(
      dir,
      'routed.yaml',
      'id: routed\nname: R\nsystemPrompt: p\ndefaultProvider: codex\ndefaultModel: nonexistent-model\n',
    );
    const providerRegistry = new ProviderRegistry();
    const fake: AgentProvider & { listModels: () => Promise<{ id: string }[]> } = {
      id: 'codex',
      async *query(_params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
        /* unused */
      },
      capabilities() {
        return { streaming: false, toolLoop: false, contextCompaction: false };
      },
      async healthCheck() {
        return true;
      },
      async listModels() {
        return [{ id: 'gpt-5-codex' }];
      },
    };
    providerRegistry.register(fake);
    const logger = captureLogger();
    await expect(
      loadAgentsFromDir({
        agentsDir: dir,
        providerRegistry,
        logger,
        bootstrap: false,
      }),
    ).rejects.toMatchObject({ kind: 'unknown-model', missing: 'nonexistent-model' });
  });

  it('passes when defaultProvider+defaultModel both exist in provider listModels', async () => {
    write(
      dir,
      'routed.yaml',
      'id: routed\nname: R\nsystemPrompt: p\ndefaultProvider: codex\ndefaultModel: gpt-5-codex\n',
    );
    const providerRegistry = new ProviderRegistry();
    const fake: AgentProvider & { listModels: () => Promise<{ id: string }[]> } = {
      id: 'codex',
      async *query(_params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
        /* unused */
      },
      capabilities() {
        return { streaming: false, toolLoop: false, contextCompaction: false };
      },
      async healthCheck() {
        return true;
      },
      async listModels() {
        return [{ id: 'gpt-5-codex' }, { id: 'gpt-5' }];
      },
    };
    providerRegistry.register(fake);
    const logger = captureLogger();
    const { registry } = await loadAgentsFromDir({
      agentsDir: dir,
      providerRegistry,
      logger,
      bootstrap: false,
    });
    expect(registry.get('routed').defaultModel).toBe('gpt-5-codex');
  });

  it('ignores non-yaml files and sub-directories', async () => {
    write(dir, 'README.md', '# dont load me');
    write(dir, 'ok.yaml', 'id: ok\nname: OK\nsystemPrompt: p\n');
    const { loaded } = await loadAgentsFromDir({
      agentsDir: dir,
      bootstrap: false,
    });
    expect(loaded).toEqual(['ok']);
  });

  it('R8: missing providerRegistry + Agent with defaultProvider → throws startup error', async () => {
    write(
      dir,
      'routed.yaml',
      'id: routed\nname: R\nsystemPrompt: p\ndefaultProvider: codex\n',
    );
    await expect(
      loadAgentsFromDir({ agentsDir: dir, bootstrap: false }),
    ).rejects.toMatchObject({
      name: 'AgentConfigResolutionError',
      kind: 'missing-provider-registry',
    });
  });

  it('malformed YAML is warned and skipped, not fatal', async () => {
    write(dir, 'broken.yaml', 'id: broken\nname:\n  - not a string\n');
    write(dir, 'ok.yaml', 'id: ok\nname: OK\nsystemPrompt: p\n');
    const logger = captureLogger();
    const { loaded, skipped } = await loadAgentsFromDir({
      agentsDir: dir,
      logger,
      bootstrap: false,
    });
    expect(loaded).toEqual(['ok']);
    expect(skipped.some((s) => s.file.endsWith('broken.yaml'))).toBe(true);
  });
});
