import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRegistry, ProviderRegistry } from '@haro/core';
import type { AgentEvent, AgentProvider, AgentQueryParams } from '@haro/core/provider';
import { runCli } from '../src/index.js';

class StubProvider implements AgentProvider {
  readonly id = 'codex';
  capabilities() {
    return { streaming: false, toolLoop: false, contextCompaction: false, contextContinuation: true } as const;
  }
  async healthCheck(): Promise<boolean> { return true; }
  async listModels(): Promise<readonly { id: string }[]> { return [{ id: 'codex-primary' }]; }
  async *query(params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
    yield { type: 'result', content: `echo:${params.prompt}`, responseId: 'resp-1' };
  }
}

interface Capture { stream: NodeJS.WritableStream; read: () => string }

function captureStream(): Capture {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk) => chunks.push(String(chunk)));
  return { stream, read: () => chunks.join('') };
}

function createProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new StubProvider());
  return registry;
}

function createAgentRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register({ id: 'haro-assistant', name: 'Haro Assistant', systemPrompt: 'helpful' });
  return registry;
}

function evolutionFileCounts(root: string) {
  const dir = join(root, 'evolution');
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).sort().map((name) => {
    const child = join(dir, name);
    return [name, existsSync(child) ? readdirSync(child).sort() : []];
  }));
}

function runGuard(root: string, argv: readonly string[]) {
  const stdout = captureStream();
  const stderr = captureStream();
  const workspaceRoot = resolve(process.cwd(), '../..');
  return {
    stdout,
    stderr,
    result: runCli({
      argv,
      root,
      projectRoot: workspaceRoot,
      stdout: stdout.stream,
      stderr: stderr.stream,
      createProviderRegistry: async () => createProviderRegistry(),
      loadAgentRegistry: async () => createAgentRegistry(),
      createAdditionalChannels: async () => [],
      now: () => new Date('2026-05-23T06:10:00.000Z'),
    }),
  };
}

describe('haro legacy-removal guard [FEAT-081A]', () => {
  const roots: string[] = [];

  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'haro-legacy-removal-guard-'));
    roots.push(root);
    return root;
  }

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('renders a read-only JSON guard report with delete denied for legacy candidates', async () => {
    const root = tempRoot();
    const before = evolutionFileCounts(root);
    const { result, stdout, stderr } = runGuard(root, ['legacy-removal', 'guard', '--dry-run', '--json']);

    await expect(result).resolves.toMatchObject({ exitCode: 0, action: 'legacy-removal' });
    expect(stderr.read()).toBe('');
    const payload = JSON.parse(stdout.read()) as { ok: true; data: {
      command: string;
      guardVersion: string;
      dryRun: boolean;
      wouldDelete: boolean;
      physicalDeleteApproved: boolean;
      status: string;
      sidecarKeepAllowlist: string[];
      summary: { total: number; stillReferencedCount: number; deleteAllowedCount: number };
      items: Array<{
        id: string;
        state: string;
        deleteAllowed: boolean;
        stillReferenced: boolean;
        pilotUnbind?: { candidate: string; status: string; note: string };
        evidence: Array<{ present: boolean; description?: string }>;
      }>;
      negativeScope: string[];
    } };
    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({
      command: 'legacy-removal guard',
      guardVersion: 'FEAT-081A',
      dryRun: true,
      wouldDelete: false,
      physicalDeleteApproved: false,
      status: 'blocked',
    });
    expect(payload.data.sidecarKeepAllowlist).toContain('packages/cli/src/commands/agentdock-sidecar.ts');
    expect(payload.data.negativeScope.join('\n')).toContain('真实 ~/.haro/evolution');
    expect(payload.data.summary.deleteAllowedCount).toBe(0);
    expect(payload.data.summary.total).toBeGreaterThanOrEqual(6);
    expect(payload.data.summary.stillReferencedCount).toBeGreaterThan(0);
    const byId = new Map(payload.data.items.map((item) => [item.id, item]));
    expect(byId.get('provider-codex')).toMatchObject({ state: 'deprecate', deleteAllowed: false, stillReferenced: true });
    expect(byId.get('channel-layer')).toMatchObject({ state: 'deprecate', deleteAllowed: false, stillReferenced: true });
    expect(byId.get('memory-fabric')).toMatchObject({ state: 'deprecate', deleteAllowed: false, stillReferenced: true });
    const agentRuntime = byId.get('agent-runtime-router');
    expect(agentRuntime?.evidence.some((entry) => entry.present)).toBe(true);
    expect(agentRuntime?.pilotUnbind).toMatchObject({
      candidate: 'packages/core/src/team-orchestrator.ts',
      status: 'default-path-unbound',
    });
    expect(agentRuntime?.pilotUnbind?.note).toContain('HARO_ENABLE_LEGACY_TEAM_ORCHESTRATOR=1');
    expect(agentRuntime?.deleteAllowed).toBe(false);
    expect(evolutionFileCounts(root)).toEqual(before);
  });

  it('renders human output as a blocker report, not a deletion approval', async () => {
    const root = tempRoot();
    const before = evolutionFileCounts(root);
    const { result, stdout, stderr } = runGuard(root, ['legacy-removal', 'guard', '--dry-run', '--human']);

    await expect(result).resolves.toMatchObject({ exitCode: 0, action: 'legacy-removal' });
    expect(stderr.read()).toBe('');
    const text = stdout.read();
    expect(text).toContain('Haro legacy removal guard: dry-run');
    expect(text).toContain('本报告不是删除批准');
    expect(text).toContain('physicalDeleteApproved: false');
    expect(text).toContain('deleteAllowed=false');
    expect(text).toContain('provider-codex');
    expect(text).toContain('FEAT-081B');
    expect(text).toContain('pilotUnbind=default-path-unbound:packages/core/src/team-orchestrator.ts');
    expect(evolutionFileCounts(root)).toEqual(before);
  });

  it('fails closed without dry-run or when confirm is requested', async () => {
    const root = tempRoot();
    const before = evolutionFileCounts(root);

    const missingDryRun = runGuard(root, ['legacy-removal', 'guard', '--json']);
    await expect(missingDryRun.result).resolves.toMatchObject({ exitCode: 2, action: 'legacy-removal' });
    expect((await missingDryRun.result).error?.message).toContain('requires --dry-run');

    const confirm = runGuard(root, ['legacy-removal', 'guard', '--dry-run', '--confirm', '--json']);
    await expect(confirm.result).resolves.toMatchObject({ exitCode: 2, action: 'legacy-removal' });
    expect((await confirm.result).error?.message).toContain('does not support --confirm');
    expect(evolutionFileCounts(root)).toEqual(before);
  });
});
