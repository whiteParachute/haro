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
    expect(payload.data.summary.nextSafeCandidateCount).toBe(0);
    expect(payload.data.summary.blockedCandidateCount).toBeGreaterThanOrEqual(3);
    expect(payload.data.summary.forbiddenCandidateCount).toBe(0);
      expect(payload.data.planning).toMatchObject({
        stage: 'FEAT-081X',
        lastCompletedStage: 'FEAT-081X',
        lastUpdatedBy: 'FEAT-081X',
      });
    expect(payload.data.planning.moduleRetirementBoundaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        module: 'channel-message',
        status: 'retire-candidate',
        owner: 'AgentDock',
        deletionCandidateAllowed: false,
      }),
      expect.objectContaining({
        module: 'run-router-runtime-scenario',
        status: 'deferred',
        deletionCandidateAllowed: false,
      }),
      expect.objectContaining({
        module: 'memory',
        protectedScope: expect.arrayContaining(['aria-memory vault']),
        deletionCandidateAllowed: false,
      }),
    ]));
    const memoryBoundary = payload.data.planning.moduleRetirementBoundaries.find((boundary) => boundary.module === 'memory');
    expect(memoryBoundary?.deletionCandidateAllowed).toBe(false);
    expect(memoryBoundary?.decision).toContain('FEAT-081U');
    expect(memoryBoundary?.decision).toContain('不触碰真实 ~/.haro 数据');
    const runtimeBoundary = payload.data.planning.moduleRetirementBoundaries.find((boundary) => boundary.module === 'run-router-runtime-scenario');
    expect(runtimeBoundary?.deferredUntil).toEqual(expect.arrayContaining([
      'AgentDock 定时任务稳定触发 Haro 生成提案',
      'Haro 创建待审 approval request',
      'Review Board 可审',
      '证明链路不依赖旧 haro run/chat/team/scenario',
    ]));
    const webBoundary = payload.data.planning.moduleRetirementBoundaries.find((boundary) => boundary.module === 'web-api');
    expect(webBoundary).toMatchObject({
      deletionCandidateAllowed: false,
      protectedScope: expect.arrayContaining(['approval review board routes', 'packages/web-api/src/routes/approval-requests.ts']),
    });
    expect(webBoundary?.decision).toContain('FEAT-081T');
    expect(webBoundary?.decision).toContain('不批准 runtime/Web/API 删除');
    expect(payload.data.planning.nextDeletionCandidate).toBeNull();
    expect(payload.data.planning.nextReviewCandidate).toBeNull();
    expect(payload.data.planning.forbiddenCandidateIds).toEqual([]);
    expect(payload.data.planning.blockedCandidateIds).toEqual(expect.arrayContaining([
      'provider-codex',
      'memory-fabric',
      'agent-runtime-router',
    ]));
    expect(payload.data.planning.blockedCandidateIds).not.toContain('web-dashboard-non-review');
    expect(payload.data.planning.deferredCandidateIds).toEqual(expect.arrayContaining([
      'skills-marketplace',
    ]));
    expect(payload.data.planning.deferredCandidateIds).not.toContain('agent-runtime-router');
    expect(payload.data.planning.completedPhysicalRemovals).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent-runtime-router', candidate: 'packages/core/src/team-orchestrator.ts', removedBy: 'FEAT-081D' }),
      expect.objectContaining({ id: 'agent-runtime-router', candidate: 'packages/cli/src/index.ts#legacy-team-orchestrator-removed-result', removedBy: 'FEAT-081S' }),
      expect.objectContaining({ id: 'channel-layer', candidate: 'packages/cli/src/gateway.ts', removedBy: 'FEAT-081E' }),
      expect.objectContaining({ id: 'channel-layer', candidate: 'packages/cli/src/index.ts#channel-setup-onboarding-stub', removedBy: 'FEAT-081H' }),
      expect.objectContaining({ id: 'channel-layer', candidate: 'packages/cli/src/index.ts#channel-config-management-commands', removedBy: 'FEAT-081J' }),
      expect.objectContaining({ id: 'channel-layer', candidate: 'packages/channel*/src#setup-contract', removedBy: 'FEAT-081J' }),
      expect.objectContaining({ id: 'channel-layer', candidate: 'packages/cli/src/index.ts#channel-list-doctor-runtime', removedBy: 'FEAT-081L' }),
      expect.objectContaining({ id: 'channel-layer', candidate: 'packages/channel', removedBy: 'FEAT-081L' }),
      expect.objectContaining({ id: 'channel-layer', candidate: 'packages/channel-feishu', removedBy: 'FEAT-081L' }),
      expect.objectContaining({ id: 'channel-layer', candidate: 'packages/channel-telegram', removedBy: 'FEAT-081L' }),
      expect.objectContaining({ id: 'provider-codex', candidate: 'packages/cli/src/provider-codex-wizard.ts', removedBy: 'FEAT-081O' }),
      expect.objectContaining({ id: 'provider-codex', candidate: 'packages/cli/src/provider-onboarding.ts#writeProviderEnvFile', removedBy: 'FEAT-081P' }),
      expect.objectContaining({ id: 'provider-codex', candidate: 'packages/cli/src/index.ts#provider-setup-retired-stub', removedBy: 'FEAT-081R' }),
      expect.objectContaining({ id: 'provider-codex', candidate: 'packages/cli/src/index.ts#provider-cli-management-surface', removedBy: 'FEAT-081X' }),
      expect.objectContaining({ id: 'memory-fabric', candidate: 'packages/cli/src/index.ts#--legacy-memory-opt-in', removedBy: 'FEAT-081U' }),
      expect.objectContaining({ id: 'memory-fabric', candidate: 'packages/cli/src/commands/memory.ts#memory-remember-write-surface+packages/mcp-tools/src/tools/memory-remember.ts#legacy-mcp-write-surface', removedBy: 'FEAT-081X' }),
      expect.objectContaining({ id: 'memory-fabric', candidate: 'packages/mcp-tools/src/tools/memory-query.ts#legacy-mcp-read-surface', removedBy: 'FEAT-081X' }),
      expect.objectContaining({ id: 'memory-fabric', candidate: 'packages/cli/src/commands/memory.ts#memory-cli-read-forensic-surfaces', removedBy: 'FEAT-081X/F-4' }),
      expect.objectContaining({ id: 'memory-fabric', candidate: 'packages/mcp-tools/src/bin/server-entry.ts#legacy-mcp-memory-bootstrap', removedBy: 'FEAT-081X/F-5' }),
      expect.objectContaining({ id: 'skills-marketplace', candidate: 'packages/skills/src/manager.ts#marketplace-install-placeholder', removedBy: 'FEAT-081V' }),
    ]));
    expect(payload.data.planning.completedPhysicalRemovals).toHaveLength(20);
    const byId = new Map(payload.data.items.map((item) => [item.id, item]));
    expect(payload.data.items.every((item) => !('physicalRemoval' in item))).toBe(true);
    const providerCodex = byId.get('provider-codex');
    expect(providerCodex).toMatchObject({ state: 'deprecate', deleteAllowed: false, stillReferenced: true });
    expect(providerCodex?.candidatePriority.status).toBe('blocked');
    expect(providerCodex?.pilotUnbind).toMatchObject({
      candidate: 'packages/cli/src/index.ts#provider-setup-onboarding-command',
      status: 'default-path-unbound',
    });
    expect(providerCodex?.decision).toContain('不获删除批准');
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('retired stub marker'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('retired stub message'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('Codex auth wizard'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('provider env file writer'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('成功输出路径'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('provider list formatter'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('provider doctor human formatter'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('provider env formatter'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('provider models helper'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('provider select config writer'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('provider select scope parser'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('no longer calls runProviderDoctor'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.physicalRemovals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidate: 'packages/cli/src/provider-codex-wizard.ts',
        removedBy: 'FEAT-081O',
      }),
      expect.objectContaining({
        candidate: 'packages/cli/src/provider-onboarding.ts#writeProviderEnvFile',
        removedBy: 'FEAT-081P',
      }),
      expect.objectContaining({
        candidate: 'packages/cli/src/index.ts#provider-setup-retired-stub',
        removedBy: 'FEAT-081R',
      }),
      expect.objectContaining({
        candidate: 'packages/cli/src/index.ts#provider-cli-management-surface',
        removedBy: 'FEAT-081X',
      }),
    ]));
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.path === 'packages/cli/src/provider-codex-wizard.ts' && entry.kind === 'exists')).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('runProviderSetupWizard'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('runChatGptLogin'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('wizard 测试'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('ProviderEnvFileWriteResult'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('renameSync'))).toMatchObject({ present: false, absent: true });
    expect(providerCodex?.verifiedAbsent.find((entry) => entry.description?.includes('chmodSync'))).toMatchObject({ present: false, absent: true });
    const channelLayer = byId.get('channel-layer');
    expect(channelLayer).toMatchObject({ state: 'deprecate', deleteAllowed: false, stillReferenced: false });
    expect(channelLayer?.candidatePriority).toMatchObject({
      status: 'done',
      rank: 1,
    });
    expect(channelLayer?.candidatePriority.forbiddenScope).toContain('MCP send_message 工具本身');
    expect(channelLayer?.pilotUnbind).toBeUndefined();
    expect(channelLayer?.physicalRemovals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidate: 'packages/cli/src/gateway.ts',
        status: 'physically-removed',
        removedBy: 'FEAT-081E',
      }),
      expect.objectContaining({
        candidate: 'packages/cli/src/index.ts#channel-setup-onboarding-stub',
        status: 'physically-removed',
        removedBy: 'FEAT-081H',
      }),
      expect.objectContaining({
        candidate: 'packages/cli/src/index.ts#channel-config-management-commands',
        status: 'physically-removed',
        removedBy: 'FEAT-081J',
      }),
      expect.objectContaining({
        candidate: 'packages/channel*/src#setup-contract',
        status: 'physically-removed',
        removedBy: 'FEAT-081J',
      }),
      expect.objectContaining({
        candidate: 'packages/cli/src/index.ts#channel-list-doctor-runtime',
        status: 'physically-removed',
        removedBy: 'FEAT-081L',
      }),
      expect.objectContaining({
        candidate: 'packages/channel',
        status: 'physically-removed',
        removedBy: 'FEAT-081L',
      }),
      expect.objectContaining({
        candidate: 'packages/channel-feishu',
        status: 'physically-removed',
        removedBy: 'FEAT-081L',
      }),
      expect.objectContaining({
        candidate: 'packages/channel-telegram',
        status: 'physically-removed',
        removedBy: 'FEAT-081L',
      }),
    ]));
    expect(channelLayer?.physicalRemovals?.find((entry) => entry.candidate === 'packages/cli/src/gateway.ts')?.note).toContain('gateway 旧 CLI daemon');
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.path === 'packages/cli/src/gateway.ts')).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('legacy env'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('removed stub code'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('removed helper'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('onboarding alias'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('不再调用旧 channel.setup'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('不再写入 channel config'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('channel enable config'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('channel disable config'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('channel remove config'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('adapter autoload'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('setup result contract'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('ManagedChannel.setup'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('Feishu setup/onboarding'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('Telegram setup/onboarding'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('mcp-tools package dependency'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('mcp-tools tsconfig'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('ToolDependencies 不再要求'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('server-entry 不再创建空'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('tests 不再使用 Haro channel'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('CLI channel list/doctor 注册'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('CLI channel registry runtime'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('packages/channel 已由 FEAT-081L'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('packages/channel-feishu 已由 FEAT-081L'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('packages/channel-telegram 已由 FEAT-081L'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.verifiedAbsent.find((entry) => entry.description?.includes('CLI package dependency 已由 FEAT-081L'))).toMatchObject({ present: false, absent: true });
    expect(channelLayer?.evidence.find((entry) => entry.path === 'packages/channel/package.json')?.present).toBe(false);
    const memoryFabric = byId.get('memory-fabric');
    expect(memoryFabric).toMatchObject({ state: 'deprecate', deleteAllowed: false, stillReferenced: true });
    expect(memoryFabric?.candidatePriority.status).toBe('blocked');
    expect(memoryFabric?.candidatePriority.forbiddenScope).toEqual(expect.arrayContaining(['真实 ~/.haro 数据', 'aria-memory vault']));
    expect(memoryFabric?.physicalRemovals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidate: 'packages/cli/src/index.ts#--legacy-memory-opt-in',
        status: 'physically-removed',
        removedBy: 'FEAT-081U',
      }),
      expect.objectContaining({
        candidate: 'packages/cli/src/commands/memory.ts#memory-remember-write-surface+packages/mcp-tools/src/tools/memory-remember.ts#legacy-mcp-write-surface',
        status: 'physically-removed',
        removedBy: 'FEAT-081X',
      }),
      expect.objectContaining({
        candidate: 'packages/mcp-tools/src/tools/memory-query.ts#legacy-mcp-read-surface',
        status: 'physically-removed',
        removedBy: 'FEAT-081X',
      }),
      expect.objectContaining({
        candidate: 'packages/cli/src/commands/memory.ts#memory-cli-read-forensic-surfaces',
        status: 'physically-removed',
        removedBy: 'FEAT-081X/F-4',
      }),
      expect.objectContaining({
        candidate: 'packages/mcp-tools/src/bin/server-entry.ts#legacy-mcp-memory-bootstrap',
        status: 'physically-removed',
        removedBy: 'FEAT-081X/F-5',
      }),
    ]));
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('--legacy-memory CLI opt-in'))).toMatchObject({ present: false, absent: true });
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('createLegacyMemoryFabric'))).toMatchObject({ present: false, absent: true });
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('writeMemoryEntry'))).toMatchObject({ present: false, absent: true });
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('writeEntry'))).toMatchObject({ present: false, absent: true });
    expect(memoryFabric?.evidence.find((entry) => entry.description?.includes('memory_query 保留注册但 retired'))).toMatchObject({ present: true });
    expect(memoryFabric?.evidence.find((entry) => entry.description?.includes('memory_query 执行入口返回 TARGET_DISABLED'))).toMatchObject({ present: true });
    expect(memoryFabric?.evidence.find((entry) => entry.description?.includes('CLI memory read/forensic surfaces 保留命令形状'))).toMatchObject({ present: true });
    expect(memoryFabric?.evidence.find((entry) => entry.description?.includes('FEAT-081X/F-4'))).toMatchObject({ present: true });
    expect(memoryFabric?.evidence.find((entry) => entry.description?.includes('FEAT-081X/F-5'))).toMatchObject({ present: true });
    expect(memoryFabric?.evidence.find((entry) => entry.description?.includes('memory_remember 执行入口返回 TARGET_DISABLED'))).toMatchObject({ present: true });
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('不再调用 Haro MemoryFabric queryMemory'))).toMatchObject({ present: false, absent: true });
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('recoverMemoryV1Snapshot'))).toMatchObject({ present: false, absent: true });
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('memory export 文件'))).toMatchObject({ present: false, absent: true });
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('destructive confirmation'))).toMatchObject({ present: false, absent: true });
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('service context'))).toMatchObject({ present: false, absent: true });
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('server-entry 不再 createMemoryFabric'))).toMatchObject({ present: false, absent: true });
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('server-entry 不再 import'))).toMatchObject({ present: false, absent: true });
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('server-entry 不再 resolve MemoryFabric'))).toMatchObject({ present: false, absent: true });
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('server-entry 不再 inject deps.memory'))).toMatchObject({ present: false, absent: true });
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('不再读取 ToolDependencies.memory'))).toMatchObject({ present: false, absent: true });
    expect(memoryFabric?.verifiedAbsent.find((entry) => entry.description?.includes('不再调用 Haro MemoryFabric searchMemoryFiles'))).toMatchObject({ present: false, absent: true });
    const skillsMarketplace = byId.get('skills-marketplace');
    expect(skillsMarketplace).toMatchObject({ state: 'freeze', deleteAllowed: false, stillReferenced: true });
    expect(skillsMarketplace?.candidatePriority).toMatchObject({
      status: 'defer',
      rank: 3,
    });
    expect(skillsMarketplace?.decision).toContain('FEAT-081V/D-1');
    expect(skillsMarketplace?.decision).toContain('不获删除批准');
    expect(skillsMarketplace?.physicalRemovals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidate: 'packages/skills/src/manager.ts#marketplace-install-placeholder',
        status: 'physically-removed',
        removedBy: 'FEAT-081V',
      }),
    ]));
    expect(skillsMarketplace?.physicalRemovals?.find((entry) => entry.candidate === 'packages/skills/src/manager.ts#marketplace-install-placeholder')?.note).toContain('local/git install');
    expect(skillsMarketplace?.evidence.find((entry) => entry.description?.includes('retired/fail-closed'))).toMatchObject({ present: true });
    expect(skillsMarketplace?.evidence.find((entry) => entry.description?.includes('local path install'))).toMatchObject({ present: true });
    expect(skillsMarketplace?.evidence.find((entry) => entry.description?.includes('git install'))).toMatchObject({ present: true });
    expect(skillsMarketplace?.evidence.find((entry) => entry.description?.includes('eat 兼容资产'))).toMatchObject({ present: true });
    expect(skillsMarketplace?.evidence.find((entry) => entry.description?.includes('shit 兼容资产'))).toMatchObject({ present: true });
    expect(skillsMarketplace?.evidence.find((entry) => entry.description?.includes('sync-runtime'))).toMatchObject({ present: true });
    expect(skillsMarketplace?.evidence.find((entry) => entry.description?.includes('prepareTask'))).toMatchObject({ present: true });
    expect(skillsMarketplace?.verifiedAbsent.find((entry) => entry.description?.includes('旧 Phase 0 marketplace install'))).toMatchObject({ present: false, absent: true });
    expect(skillsMarketplace?.verifiedAbsent.find((entry) => entry.description?.includes('下载未接入'))).toMatchObject({ present: false, absent: true });
    const agentRuntime = byId.get('agent-runtime-router');
    expect(agentRuntime?.evidence.some((entry) => entry.present)).toBe(true);
    expect(agentRuntime?.candidatePriority).toMatchObject({
      status: 'blocked',
      rank: 6,
    });
    expect(agentRuntime?.candidatePriority.reason).toContain('081S 只解除 TeamOrchestrator removed-result');
    expect(agentRuntime?.physicalRemovals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidate: 'packages/core/src/team-orchestrator.ts',
        status: 'physically-removed',
        removedBy: 'FEAT-081D',
      }),
      expect.objectContaining({
        candidate: 'packages/cli/src/index.ts#legacy-team-orchestrator-removed-result',
        status: 'physically-removed',
        removedBy: 'FEAT-081S',
      }),
    ]));
    expect(agentRuntime?.physicalRemovals?.find((entry) => entry.candidate === 'packages/core/src/team-orchestrator.ts')?.note).toContain('未获物理删除批准');
    const evidenceByPath = new Map(agentRuntime?.evidence.map((entry) => [entry.path, entry.present]));
    const absentByPath = new Map(agentRuntime?.verifiedAbsent.map((entry) => [entry.path, entry.absent]));
    expect(absentByPath.get('packages/core/src/team-orchestrator.ts')).toBe(true);
    expect(absentByPath.get('packages/core/src/legacy/team-orchestrator.ts')).toBe(true);
    expect(absentByPath.get('packages/core/package.json')).toBe(true);
    expect(agentRuntime?.verifiedAbsent.find((entry) => entry.description?.includes('兼容函数'))).toMatchObject({ present: false, absent: true });
    expect(agentRuntime?.verifiedAbsent.find((entry) => entry.description?.includes('专用 payload'))).toMatchObject({ present: false, absent: true });
    expect(evidenceByPath.get('packages/core/src/scenario-router.ts')).toBe(true);
    expect(agentRuntime?.deleteAllowed).toBe(false);
    const webDashboard = byId.get('web-dashboard-non-review');
    expect(webDashboard).toMatchObject({ state: 'freeze', deleteAllowed: false, stillReferenced: true });
    expect(webDashboard?.candidatePriority).toMatchObject({
      status: 'done',
      rank: 5,
    });
    expect(webDashboard?.candidatePriority.reason).toContain('非 review Web/API surface 为空');
    expect(webDashboard?.candidatePriority.forbiddenScope).toEqual(expect.arrayContaining([
      'packages/web',
      'packages/web-api',
      'approval review board routes',
    ]));
    expect(webDashboard?.physicalRemovals).toBeUndefined();
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
    expect(text).toContain('planning stage: FEAT-081X lastCompleted=FEAT-081X');
    expect(text).toContain('next deletion candidate (candidate only, not approval): none');
    expect(text).toContain('next review candidate: none');
    expect(text).toContain('forbidden now: none');
    expect(text).toContain('deferred now: skills-marketplace');
    expect(text).toContain('module retirement boundaries:');
    expect(text).toContain('channel-message status=retire-candidate owner=AgentDock');
    expect(text).toContain('provider status=retire-candidate owner=AgentDock / ModelHub deletionCandidateAllowed=false');
    expect(text).toContain('skills status=retire-candidate owner=AgentDock skills deletionCandidateAllowed=false');
    expect(text).toContain('web-api status=retire-candidate owner=Haro Review Board + AgentDock Web deletionCandidateAllowed=false');
    expect(text).toContain('run-router-runtime-scenario status=deferred');
    expect(text).toContain('verifiedAbsent: total=');
    expect(text).toContain('failed=0');
    expect(text).toContain('priority=done#1');
    expect(text).toContain('FEAT-081D');
    expect(text).toContain('FEAT-081E');
    expect(text).toContain('FEAT-081H');
    expect(text).toContain('FEAT-081J');
    expect(text).toContain('FEAT-081K');
    expect(text).toContain('FEAT-081L');
    expect(text).toContain('FEAT-081M');
    expect(text).toContain('FEAT-081N');
    expect(text).toContain('FEAT-081O');
    expect(text).toContain('FEAT-081P');
    expect(text).toContain('FEAT-081R');
    expect(text).toContain('FEAT-081S');
    expect(text).toContain('FEAT-081T');
    expect(text).toContain('FEAT-081U');
    expect(text).toContain('FEAT-081V');
    expect(text).toContain('FEAT-081X');
    expect(text).toContain('非 review Web/API surface 为空');
    expect(text).toContain('haro run --legacy-memory CLI opt-in');
    expect(text).toContain('Haro-owned memory write surfaces');
    expect(text).toContain('marketplace:<name> 占位 install surface');
    expect(text).toContain('standalone haro provider CLI 管理面');
    expect(text).toContain('provider setup/onboarding CLI 入口 retired/fail-closed');
    expect(text).toContain('pilotUnbind=default-path-unbound:packages/cli/src/index.ts#provider-setup-onboarding-command');
    expect(text).toContain('AgentDock IPC 消息 contract');
    expect(text).toContain('packages/channel、packages/channel-feishu、packages/channel-telegram');
    expect(text).not.toContain('physicalRemoval=');
    expect(text).toContain('physicalRemovals=physically-removed:packages/core/src/team-orchestrator.ts:FEAT-081D');
    expect(text).toContain('physically-removed:packages/cli/src/index.ts#legacy-team-orchestrator-removed-result:FEAT-081S');
    expect(text).toContain('physicalRemovals=physically-removed:packages/cli/src/gateway.ts:FEAT-081E');
    expect(text).toContain('physically-removed:packages/cli/src/index.ts#channel-setup-onboarding-stub:FEAT-081H');
    expect(text).toContain('physically-removed:packages/cli/src/index.ts#channel-config-management-commands:FEAT-081J');
    expect(text).toContain('physically-removed:packages/channel*/src#setup-contract:FEAT-081J');
    expect(text).toContain('physically-removed:packages/channel:FEAT-081L');
    expect(text).toContain('physically-removed:packages/channel-feishu:FEAT-081L');
    expect(text).toContain('physically-removed:packages/channel-telegram:FEAT-081L');
    expect(text).toContain('physically-removed:packages/cli/src/provider-codex-wizard.ts:FEAT-081O');
    expect(text).toContain('physically-removed:packages/cli/src/provider-onboarding.ts#writeProviderEnvFile:FEAT-081P');
    expect(text).toContain('physically-removed:packages/cli/src/index.ts#provider-setup-retired-stub:FEAT-081R');
    expect(text).toContain('physically-removed:packages/cli/src/index.ts#provider-cli-management-surface:FEAT-081X');
    expect(text).toContain('physicalRemovals=physically-removed:packages/cli/src/index.ts#--legacy-memory-opt-in:FEAT-081U');
    expect(text).toContain('physically-removed:packages/cli/src/commands/memory.ts#memory-remember-write-surface+packages/mcp-tools/src/tools/memory-remember.ts#legacy-mcp-write-surface:FEAT-081X');
    expect(text).toContain('physically-removed:packages/mcp-tools/src/tools/memory-query.ts#legacy-mcp-read-surface:FEAT-081X');
    expect(text).toContain('physically-removed:packages/mcp-tools/src/bin/server-entry.ts#legacy-mcp-memory-bootstrap:FEAT-081X/F-5');
    expect(text).toContain('physicalRemovals=physically-removed:packages/skills/src/manager.ts#marketplace-install-placeholder:FEAT-081V');
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

describe('haro memory CLI read/forensic surfaces [FEAT-081X/F-4]', () => {
  const roots: string[] = [];

  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'haro-memory-cli-read-retired-'));
    roots.push(root);
    return root;
  }

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  async function runMemory(root: string, argv: string[]) {
    const { result, stdout, stderr } = runGuard(root, argv);
    const resolved = await result;
    return { result: resolved, stdout: stdout.read(), stderr: stderr.read() };
  }

  it('fails closed for CLI memory read/forensic actions without exporting or recovering data', async () => {
    const root = tempRoot();
    const exportPath = join(root, 'memory-export.json');
    const cases: string[][] = [
      ['memory', 'query', 'needle', '--json'],
      ['memory', 'list', '--json'],
      ['memory', 'show', 'mem-1', '--json'],
      ['memory', 'export', '--output', exportPath],
      ['memory', 'recover-snapshot', '--yes', '--quiet'],
    ];

    for (const argv of cases) {
      const out = await runMemory(root, argv);
      expect(out.result.exitCode).toBe(1);
      expect(out.stderr).toContain('retired');
      expect(out.stderr).toContain('FEAT-081X/F-4');
      expect(out.stderr).toContain('AgentDock self-evolution sidecar');
      expect(out.stderr).toContain('not read, deleted, exported, recovered, or migrated');
    }
    expect(existsSync(exportPath)).toBe(false);
  });

  it('keeps memory remember on the FEAT-081X/F-2 retired write path', async () => {
    const root = tempRoot();
    const out = await runMemory(root, ['memory', 'remember', 'do not write', '--scope', 'shared']);
    expect(out.result.exitCode).toBe(1);
    expect(out.stderr).toContain('retired');
    expect(out.stderr).toContain('FEAT-081X/F-2');
    expect(out.stderr).toContain('AgentDock memory');
  });
});
