import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
      summary: {
        total: number;
        stillReferencedCount: number;
        deleteAllowedCount: number;
        verifiedAbsentCount: number;
        verifiedAbsentFailedCount: number;
        nextSafeCandidateCount: number;
        blockedCandidateCount: number;
        forbiddenCandidateCount: number;
      };
      planning: {
        stage: string;
        lastCompletedStage: string;
        lastUpdatedBy: string;
        moduleRetirementBoundaries: Array<{
          module: string;
          status: string;
          owner: string;
          deletionCandidateAllowed: boolean;
          haroRetireScope: string[];
          protectedScope: string[];
          decision: string;
          nextAction: string;
          deferredUntil?: string[];
        }>;
        nextDeletionCandidate: null | {
          id: string;
          title: string;
          nextScope: string;
          reason: string;
          requiredBeforeDelete: string[];
          forbiddenScope: string[];
        };
        nextReviewCandidate: null | {
          id: string;
          title: string;
          reviewScope: string;
          reviewPurpose: string;
          reason: string;
          notApproval: boolean;
          requiredBeforeDelete: string[];
          forbiddenScope: string[];
        };
        forbiddenCandidateIds: string[];
        blockedCandidateIds: string[];
        deferredCandidateIds: string[];
        completedPhysicalRemovals: Array<{ id: string; candidate: string; removedBy: string; rollbackPlan: string }>;
      };
      items: Array<{
        id: string;
        state: string;
        deleteAllowed: boolean;
        stillReferenced: boolean;
        candidatePriority: {
          status: string;
          rank?: number;
          nextScope?: string;
          reason: string;
          blockedUntil?: string[];
          forbiddenScope?: string[];
        };
        pilotUnbind?: { candidate: string; status: string; note: string };
        physicalRemoval?: { candidate: string; status: string; removedBy: string; rollbackPlan: string; note: string };
        physicalRemovals?: Array<{ candidate: string; status: string; removedBy: string; rollbackPlan: string; note: string }>;
        evidence: Array<{ path: string; present: boolean; description?: string }>;
        verifiedAbsent: Array<{ path: string; present: boolean; absent: boolean; description?: string }>;
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
    expect(payload.data.summary.verifiedAbsentCount).toBeGreaterThanOrEqual(7);
    expect(payload.data.summary.verifiedAbsentFailedCount).toBe(0);
    expect(payload.data.summary.nextSafeCandidateCount).toBe(1);
    expect(payload.data.summary.blockedCandidateCount).toBeGreaterThanOrEqual(3);
    expect(payload.data.summary.forbiddenCandidateCount).toBe(0);
    expect(payload.data.planning).toMatchObject({
      stage: 'FEAT-081I',
      lastCompletedStage: 'FEAT-081I',
      lastUpdatedBy: 'FEAT-081I',
    });
    expect(payload.data.planning.moduleRetirementBoundaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        module: 'channel-message',
        status: 'retire-candidate',
        owner: 'AgentDock',
        deletionCandidateAllowed: true,
      }),
      expect.objectContaining({
        module: 'run-router-runtime-scenario',
        status: 'deferred',
        deletionCandidateAllowed: false,
      }),
      expect.objectContaining({
        module: 'memory',
        protectedScope: expect.arrayContaining(['aria-memory vault']),
      }),
    ]));
    const runtimeBoundary = payload.data.planning.moduleRetirementBoundaries.find((boundary) => boundary.module === 'run-router-runtime-scenario');
    expect(runtimeBoundary?.deferredUntil).toEqual(expect.arrayContaining([
      'AgentDock 定时任务稳定触发 Haro 生成提案',
      'Haro 创建待审 approval request',
      'Review Board 可审',
      '证明链路不依赖旧 haro run/chat/team/scenario',
    ]));
    expect(payload.data.planning.nextDeletionCandidate).toMatchObject({
      id: 'channel-layer',
      nextScope: expect.stringContaining('Haro-owned channel packages'),
      forbiddenScope: expect.arrayContaining([
        'packages/mcp-tools/src/tools/send-message.ts',
        'AgentDock 生产消息能力',
      ]),
    });
    expect(payload.data.planning.nextReviewCandidate).toMatchObject({
      id: 'channel-layer',
      reviewScope: expect.stringContaining('Haro-owned channel packages'),
      notApproval: true,
      forbiddenScope: expect.arrayContaining(['packages/mcp-tools/src/tools/send-message.ts']),
    });
    expect(payload.data.planning.nextReviewCandidate?.reason).toContain('不是删除授权');
    expect(payload.data.planning.forbiddenCandidateIds).toEqual([]);
    expect(payload.data.planning.blockedCandidateIds).toEqual(expect.arrayContaining([
      'provider-codex',
      'memory-fabric',
      'web-dashboard-non-review',
    ]));
    expect(payload.data.planning.blockedCandidateIds).not.toContain('agent-runtime-router');
    expect(payload.data.planning.deferredCandidateIds).toEqual(expect.arrayContaining([
      'agent-runtime-router',
      'skills-marketplace',
    ]));
    expect(payload.data.planning.completedPhysicalRemovals).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent-runtime-router', candidate: 'packages/core/src/team-orchestrator.ts', removedBy: 'FEAT-081D' }),
      expect.objectContaining({ id: 'channel-layer', candidate: 'packages/cli/src/gateway.ts', removedBy: 'FEAT-081E' }),
      expect.objectContaining({ id: 'channel-layer', candidate: 'packages/cli/src/index.ts#channel-setup-onboarding-stub', removedBy: 'FEAT-081H' }),
    ]));
    const byId = new Map(payload.data.items.map((item) => [item.id, item]));
    expect(byId.get('provider-codex')).toMatchObject({ state: 'deprecate', deleteAllowed: false, stillReferenced: true });
    const channelLayer = byId.get('channel-layer');
    expect(channelLayer).toMatchObject({ state: 'deprecate', deleteAllowed: false, stillReferenced: true });
    expect(channelLayer?.candidatePriority).toMatchObject({
      status: 'next-safe-candidate',
      rank: 1,
      nextScope: expect.stringContaining('Haro-owned channel packages'),
    });
    expect(channelLayer?.candidatePriority.forbiddenScope).toContain('packages/mcp-tools/src/tools/send-message.ts');
    expect(channelLayer?.pilotUnbind).toBeUndefined();
    expect(channelLayer?.physicalRemoval).toMatchObject({
      candidate: 'packages/cli/src/gateway.ts',
      status: 'physically-removed',
      removedBy: 'FEAT-081E',
    });
    expect(channelLayer?.physicalRemovals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidate: 'packages/cli/src/index.ts#channel-setup-onboarding-stub',
        status: 'physically-removed',
        removedBy: 'FEAT-081H',
      }),
    ]));
    expect(channelLayer?.physicalRemoval?.note).toContain('未获物理删除批准');
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.path === 'packages/cli/src/gateway.ts')).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('legacy env'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('removed stub code'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('removed helper'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('onboarding alias'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('不再调用旧 channel.setup'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('不再写入 channel config'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.evidence.find((entry) => entry.path === 'packages/channel/package.json')?.present).toBe(true);
    expect(channelLayer?.evidence.find((entry) => entry.path === 'packages/mcp-tools/src/tools/send-message.ts')?.present).toBe(true);
    expect(byId.get('memory-fabric')).toMatchObject({ state: 'deprecate', deleteAllowed: false, stillReferenced: true });
    const agentRuntime = byId.get('agent-runtime-router');
    expect(agentRuntime?.evidence.some((entry) => entry.present)).toBe(true);
    expect(agentRuntime?.candidatePriority).toMatchObject({
      status: 'defer',
      rank: 6,
      nextScope: 'deferred until AgentDock scheduled proposal chain is stable',
    });
    expect(agentRuntime?.candidatePriority.reason).toContain('第 4 项按用户边界 deferred');
    expect(agentRuntime?.physicalRemoval).toMatchObject({
      candidate: 'packages/core/src/team-orchestrator.ts',
      status: 'physically-removed',
      removedBy: 'FEAT-081D',
    });
    expect(agentRuntime?.physicalRemoval?.note).toContain('未获物理删除批准');
    const evidenceByPath = new Map(agentRuntime?.evidence.map((entry) => [entry.path, entry.present]));
    const absentByPath = new Map(agentRuntime?.verifiedAbsent.map((entry) => [entry.path, entry.absent]));
    expect(absentByPath.get('packages/core/src/team-orchestrator.ts')).toBe(true);
    expect(absentByPath.get('packages/core/src/legacy/team-orchestrator.ts')).toBe(true);
    expect(absentByPath.get('packages/core/package.json')).toBe(true);
    expect(evidenceByPath.get('packages/core/src/scenario-router.ts')).toBe(true);
    expect(agentRuntime?.deleteAllowed).toBe(false);
    expect(byId.get('web-dashboard-non-review')?.candidatePriority.status).toBe('blocked');
    expect(byId.get('web-dashboard-non-review')?.candidatePriority.forbiddenScope).toContain('approval review board routes');
    const workspaceRoot = resolve(process.cwd(), '../..');
    expect(existsSync(join(workspaceRoot, 'packages/core/src/team-orchestrator.ts'))).toBe(false);
    expect(existsSync(join(workspaceRoot, 'packages/core/src/legacy/team-orchestrator.ts'))).toBe(false);
    expect(readFileSync(join(workspaceRoot, 'packages/core/package.json'), 'utf8')).not.toContain('./legacy/team-orchestrator');
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
    expect(text).toContain('planning stage: FEAT-081I lastCompleted=FEAT-081I');
    expect(text).toContain('next deletion candidate (candidate only, not approval): channel-layer');
    expect(text).toContain('next review candidate: channel-layer');
    expect(text).toContain('notApproval=true');
    expect(text).toContain('forbidden now: none');
    expect(text).toContain('deferred now: agent-runtime-router,skills-marketplace');
    expect(text).toContain('module retirement boundaries:');
    expect(text).toContain('channel-message status=retire-candidate owner=AgentDock');
    expect(text).toContain('run-router-runtime-scenario status=deferred');
    expect(text).toContain('verifiedAbsent: total=');
    expect(text).toContain('failed=0');
    expect(text).toContain('priority=next-safe-candidate#1');
    expect(text).toContain('FEAT-081D');
    expect(text).toContain('FEAT-081E');
    expect(text).toContain('FEAT-081H');
    expect(text).toContain('physicalRemoval=physically-removed:packages/core/src/team-orchestrator.ts:FEAT-081D');
    expect(text).toContain('physicalRemoval=physically-removed:packages/cli/src/gateway.ts:FEAT-081E');
    expect(text).toContain('physicalRemovals=physically-removed:packages/cli/src/index.ts#channel-setup-onboarding-stub:FEAT-081H');
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
