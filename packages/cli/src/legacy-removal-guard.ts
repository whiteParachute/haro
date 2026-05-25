import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type LegacyRemovalState = 'keep' | 'freeze' | 'deprecate' | 'remove-candidate';
export type LegacyRemovalEvidenceKind = 'exists' | 'contains';
export type LegacyCandidatePriorityStatus = 'done' | 'next-safe-candidate' | 'blocked' | 'forbidden' | 'defer';

export interface LegacyCandidatePriority {
  status: LegacyCandidatePriorityStatus;
  rank?: number;
  nextScope?: string;
  reason: string;
  blockedUntil?: string[];
  forbiddenScope?: string[];
}

export interface LegacyRemovalEvidenceDefinition {
  path: string;
  kind: LegacyRemovalEvidenceKind;
  pattern?: string;
  description: string;
}

export interface LegacyRemovalGuardDefinition {
  id: string;
  title: string;
  category: 'package' | 'cli' | 'mcp' | 'core-export' | 'web-api' | 'docs-tests';
  state: LegacyRemovalState;
  candidatePaths: string[];
  replacement: string;
  blockingDependencies: string[];
  requiredVerification: string[];
  decision: string;
  candidatePriority: LegacyCandidatePriority;
  pilotUnbind?: {
    candidate: string;
    status: 'default-path-unbound';
    note: string;
  };
  physicalRemoval?: {
    candidate: string;
    status: 'physically-removed';
    removedBy: 'FEAT-081D' | 'FEAT-081E';
    rollbackPlan: string;
    note: string;
  };
  evidence: LegacyRemovalEvidenceDefinition[];
  verifiedAbsent?: LegacyRemovalEvidenceDefinition[];
}

export interface LegacyRemovalEvidenceResult extends LegacyRemovalEvidenceDefinition {
  present: boolean;
}

export interface LegacyRemovalVerifiedAbsentResult extends LegacyRemovalEvidenceDefinition {
  present: boolean;
  absent: boolean;
}

export interface LegacyRemovalGuardItem extends Omit<LegacyRemovalGuardDefinition, 'evidence' | 'verifiedAbsent'> {
  evidence: LegacyRemovalEvidenceResult[];
  verifiedAbsent: LegacyRemovalVerifiedAbsentResult[];
  stillReferenced: boolean;
  deleteAllowed: false;
}

export interface LegacyRemovalGuardReport {
  command: 'legacy-removal guard';
  guardVersion: 'FEAT-081A';
  dryRun: true;
  wouldDelete: false;
  physicalDeleteApproved: false;
  status: 'blocked';
  workspaceRoot: string;
  sidecarKeepAllowlist: string[];
  negativeScope: string[];
  summary: {
    total: number;
    keepCount: number;
    freezeCount: number;
    deprecateCount: number;
    removeCandidateCount: number;
    stillReferencedCount: number;
    deleteAllowedCount: 0;
    verifiedAbsentCount: number;
    verifiedAbsentFailedCount: number;
    nextSafeCandidateCount: number;
    blockedCandidateCount: number;
    forbiddenCandidateCount: number;
  };
  planning: {
    stage: 'FEAT-081F';
    nextDeletionCandidate: {
      id: string;
      title: string;
      nextScope: string;
      reason: string;
      requiredBeforeDelete: string[];
      forbiddenScope: string[];
    } | null;
    forbiddenCandidateIds: string[];
    blockedCandidateIds: string[];
    completedPhysicalRemovals: Array<{ id: string; candidate: string; removedBy: 'FEAT-081D' | 'FEAT-081E'; rollbackPlan: string }>;
  };
  items: LegacyRemovalGuardItem[];
  nextActions: string[];
}

export const SIDECAR_KEEP_ALLOWLIST = [
  'packages/agentdock-contract',
  'packages/cli/src/commands/agentdock-sidecar.ts',
  'packages/mcp-tools/src/sidecar-tools.ts',
  'packages/web-api/src/routes/approval-requests.ts',
  'packages/web/src',
  'docs/planning/haro-sidecar-subtraction-and-feedback-loop.md',
];

export const LEGACY_REMOVAL_NEGATIVE_SCOPE = [
  '真实 ~/.haro/evolution 运行数据',
  'approval decisions / proposals / validations / applications / rollbacks 真实 artifact',
  'AgentDock host 代码',
  '自动 approve/apply/rollback/confirm',
  '未经单项批准的物理删除 package/module/file',
];

export const LEGACY_REMOVAL_GUARD_DEFINITIONS: LegacyRemovalGuardDefinition[] = [
  {
    id: 'provider-codex',
    title: 'Haro-owned provider / Codex provider',
    category: 'package',
    state: 'deprecate',
    candidatePaths: ['packages/provider-codex', 'packages/cli/src/provider-onboarding.ts'],
    replacement: 'AgentDock / ModelHub provider bridge',
    blockingDependencies: [
      '移除 CLI 默认 createCodexProvider 构造',
      '稳定 provider setup legacy warning',
      '确认 AgentDock provider bridge 已覆盖 run/chat 旧能力',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/provider-codex test', 'pnpm -F @haro/cli test:legacy'],
    decision: '保持 deprecate；本轮不删除。',
    candidatePriority: {
      status: 'blocked',
      rank: 4,
      reason: 'provider-codex 仍被 CLI bootstrap 与后续 LLM draft/provider 能力引用。',
      blockedUntil: ['AgentDock/ModelHub provider bridge 接管默认 provider', '移除 CLI 默认 createCodexProvider 构造', 'LLM draft provider path 完成替代验证'],
    },
    evidence: [
      { path: 'packages/provider-codex/package.json', kind: 'exists', description: 'provider package 仍存在' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'createCodexProvider', description: 'CLI bootstrap 仍引用 Codex provider' },
      { path: 'packages/cli/package.json', kind: 'contains', pattern: '@haro/provider-codex', description: 'CLI package dependency 仍存在' },
    ],
  },
  {
    id: 'channel-layer',
    title: 'Haro-owned channel layer',
    category: 'package',
    state: 'deprecate',
    candidatePaths: ['packages/channel', 'packages/channel-feishu', 'packages/channel-telegram'],
    replacement: 'AgentDock IM / channel layer',
    blockingDependencies: [
      '隔离 mcp-tools legacy send_message tool',
      'FEAT-081G 已摘线 CLI channel setup/onboarding 默认执行路径',
      '确认 AgentDock IM 已承接生产消息通道',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/channel test', 'pnpm -F @haro/cli test:legacy'],
    decision: '保持 deprecate/freeze；FEAT-081G 仅摘线 channel setup/onboarding 旧入口，channel package/IM 能力未批准删除。',
    candidatePriority: {
      status: 'done',
      rank: 1,
      nextScope: 'packages/cli/src/channel.ts#setup-onboarding',
      reason: 'FEAT-081G 已将 channel setup/onboarding 旧入口从默认执行路径摘线；channel packages 与生产消息路径仍保留。',
      blockedUntil: ['后续若要物理删除 channel onboarding stub，必须单项评审', '证明 MCP send_message 与 Feishu/Telegram 生产消息路径不受影响', '确认 AgentDock IM 已承接相关 onboarding 流程'],
      forbiddenScope: ['packages/channel', 'packages/channel-feishu', 'packages/channel-telegram', 'packages/mcp-tools/src/tools/send-message.ts'],
    },
    pilotUnbind: {
      candidate: 'packages/cli/src/channel.ts#setup-onboarding',
      status: 'default-path-unbound',
      note: 'FEAT-081G 默认 haro channel setup/onboarding 只返回 removed/fail-closed 报告，不调用 channel.setup，不写 channel config。',
    },
    physicalRemoval: {
      candidate: 'packages/cli/src/gateway.ts',
      status: 'physically-removed',
      removedBy: 'FEAT-081E',
      rollbackPlan: 'git revert FEAT-081E commit 可恢复 gateway 源码、legacy env 注册路径和旧 gateway 测试。',
      note: '仅 gateway 旧 CLI daemon/control-plane 入口被删除；channel/provider/memory/skills/Web/scenario-router 未获物理删除批准。',
    },
    evidence: [
      { path: 'packages/channel/package.json', kind: 'exists', description: 'channel package 仍存在，不在 081E 删除范围' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'registerChannelCommands', description: 'CLI 仍注册 channel 入口' },
      { path: 'packages/mcp-tools/src/tools/send-message.ts', kind: 'exists', description: 'MCP legacy send_message tool 仍存在' },
    ],
    verifiedAbsent: [
      { path: 'packages/cli/src/gateway.ts', kind: 'exists', description: 'gateway 旧 CLI daemon 源文件已由 FEAT-081E 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: "HARO_ENABLE_LEGACY_GATEWAY_COMMANDS === '1'", description: 'gateway legacy env 注册判断已由 FEAT-081E 移除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'entry.channel.setup(createChannelSetupContext', description: 'channel setup/onboarding 不再调用旧 channel.setup 实现' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'updateChannelConfig(app, id, { ...result.config, enabled: true })', description: 'channel setup/onboarding 不再写入 channel config' },
    ],
  },
  {
    id: 'memory-fabric',
    title: 'MemoryFabric / Haro-owned memory',
    category: 'core-export',
    state: 'deprecate',
    candidatePaths: ['packages/core/src/memory', 'packages/cli/src/commands/memory.ts'],
    replacement: 'AgentDock memory MCP / aria-memory owner',
    blockingDependencies: [
      '移除 core barrel MemoryFabric export',
      '确认 mcp-tools memory_* legacy registry 已隔离',
      '确认 sidecar 主链路不读写 Haro-owned memory',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/core test:legacy', 'pnpm -F @haro/cli test:legacy'],
    decision: '保持 deprecate；真实 memory 数据不在删除范围。',
    candidatePriority: {
      status: 'blocked',
      rank: 5,
      reason: 'Haro-owned memory 牵涉真实用户数据和 MCP memory tools，删除前必须先完成数据/owner 边界验证。',
      blockedUntil: ['确认真实 ~/.haro memory 数据迁移/保留策略', '隔离 MCP memory_* 默认 registry', '证明 sidecar 主链路不读写 Haro-owned memory'],
      forbiddenScope: ['真实 ~/.haro 数据', 'aria-memory vault'],
    },
    evidence: [
      { path: 'packages/core/src/index.ts', kind: 'contains', pattern: 'createMemoryFabric', description: 'core barrel 仍导出 MemoryFabric' },
      { path: 'packages/cli/src/commands/memory.ts', kind: 'exists', description: 'legacy memory CLI 仍存在' },
      { path: 'packages/mcp-tools/src/index.ts', kind: 'contains', pattern: 'memoryRememberTool', description: 'MCP default registry 仍注册 memory tool' },
    ],
  },
  {
    id: 'agent-runtime-router',
    title: 'Agent/runtime/scenario/team execution path',
    category: 'core-export',
    state: 'freeze',
    candidatePaths: [
      'packages/core/src/agent',
      'packages/core/src/runtime',
      'packages/core/src/team-orchestrator.ts',
      'packages/core/src/scenario-router.ts',
    ],
    replacement: 'AgentDock workspace / runner / multi-agent orchestration',
    blockingDependencies: [
      'CLI run/chat 完全 legacy 化或迁移',
      '解除 packages/core/src/index.ts barrel exports',
      '完成 L2/L3 workspace execution plan contract',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/core test:legacy', 'pnpm -F @haro/cli test:legacy'],
    decision: 'FEAT-081D 已物理删除 TeamOrchestrator 旧兼容路径；agent/runtime/scenario 其它候选仍保持 freeze，未批准删除。',
    candidatePriority: {
      status: 'blocked',
      rank: 3,
      nextScope: 'packages/core/src/scenario-router.ts',
      reason: 'TeamOrchestrator 已删除，但 scenario-router/agent/runtime 仍被 CLI run 与 legacy tests 引用。',
      blockedUntil: ['迁移或 legacy 化 haro run/chat 路由', '证明 ScenarioRouter 不再被 CLI bootstrap 使用', '完成 L2/L3 workspace execution plan contract'],
    },
    physicalRemoval: {
      candidate: 'packages/core/src/team-orchestrator.ts',
      status: 'physically-removed',
      removedBy: 'FEAT-081D',
      rollbackPlan: 'git revert FEAT-081D commit 可恢复 team-orchestrator 源码、legacy export、CLI 兼容路径与旧测试。',
      note: '仅 TeamOrchestrator 旧兼容入口被删除；gateway/provider/channel/memory/skills/Web/scenario-router 未获物理删除批准。',
    },
    evidence: [
      { path: 'packages/core/src/scenario-router.ts', kind: 'exists', description: 'scenario router 文件仍存在，不在 081D 删除范围' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'ScenarioRouter', description: 'CLI bootstrap 仍构造/引用 scenario router' },
    ],
    verifiedAbsent: [
      { path: 'packages/core/src/team-orchestrator.ts', kind: 'exists', description: 'team orchestrator 源文件已由 FEAT-081D 删除' },
      { path: 'packages/core/src/legacy/team-orchestrator.ts', kind: 'exists', description: 'team orchestrator legacy re-export 已由 FEAT-081D 删除' },
      { path: 'packages/core/package.json', kind: 'contains', pattern: './legacy/team-orchestrator', description: 'legacy package export 已由 FEAT-081D 移除' },
    ],
  },
  {
    id: 'skills-marketplace',
    title: '通用 skills subsystem / marketplace',
    category: 'package',
    state: 'freeze',
    candidatePaths: ['packages/skills'],
    replacement: 'Haro sidecar artifacts / AgentDock skills and MCP',
    blockingDependencies: [
      '确认 sidecar 主链路不依赖 packages/skills',
      '保留或迁移 eat/shit 资产语义',
      'legacy tests 分类稳定',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/skills test', 'pnpm -F @haro/cli test:legacy'],
    decision: '保持 freeze；不新增 marketplace 能力。',
    candidatePriority: {
      status: 'defer',
      rank: 2,
      reason: 'packages/skills 仍承载 eat/shit 兼容流程；可后续先评审 marketplace 扩展面，但不应删除核心兼容资产。',
      blockedUntil: ['确认 eat/shit 资产语义由 sidecar artifacts 或 AgentDock skills 承接', '拆分 marketplace 与保留技能资产边界'],
    },
    evidence: [
      { path: 'packages/skills/package.json', kind: 'exists', description: 'skills package 仍存在' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'SkillsManager', description: 'CLI bootstrap 仍初始化 SkillsManager' },
    ],
  },
  {
    id: 'web-dashboard-non-review',
    title: 'Web/API 非 review board dashboard surface',
    category: 'web-api',
    state: 'freeze',
    candidatePaths: ['packages/web', 'packages/web-api'],
    replacement: 'Haro Web 只保留 proposal review board；通用控制台由 AgentDock 承接',
    blockingDependencies: [
      '列出 review board endpoint allowlist',
      '确认 provider/channel/runtime 页面不在主入口',
      'Web/API 路由删除需单独批准',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/web-api test', 'pnpm -F @haro/web build'],
    decision: '保留 review board；非 review dashboard 只能后续逐路由评审。',
    candidatePriority: {
      status: 'forbidden',
      reason: 'Review Board 是 Haro sidecar 主链路看板，Web/API 包级删除被禁止；只能逐个非 review 路由评审。',
      forbiddenScope: ['packages/web', 'packages/web-api', 'approval review board routes'],
    },
    evidence: [
      { path: 'packages/web-api/src/routes/approval-requests.ts', kind: 'exists', description: 'approval review API 是 keep allowlist' },
      { path: 'packages/web/src', kind: 'exists', description: 'Web package 仍存在' },
    ],
  },
];

export function resolveLegacyRemovalWorkspaceRoot(start: string = process.cwd()): string {
  let current = resolve(start);
  try {
    if (existsSync(current) && statSync(current).isFile()) current = dirname(current);
  } catch {
    // Keep the resolved start path; the upward walk below will fail closed.
  }
  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml')) && existsSync(join(current, 'packages'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

export function buildLegacyRemovalGuardReport(workspaceRoot: string): LegacyRemovalGuardReport {
  const root = resolveLegacyRemovalWorkspaceRoot(workspaceRoot);
  const items = LEGACY_REMOVAL_GUARD_DEFINITIONS.map((definition): LegacyRemovalGuardItem => {
    const check = (entry: LegacyRemovalEvidenceDefinition): boolean => {
      const absolute = join(root, entry.path);
      return entry.kind === 'exists'
        ? existsSync(absolute)
        : existsSync(absolute) && readFileSync(absolute, 'utf8').includes(entry.pattern ?? '');
    };
    const evidence = definition.evidence.map((entry): LegacyRemovalEvidenceResult => ({ ...entry, present: check(entry) }));
    const verifiedAbsent = (definition.verifiedAbsent ?? []).map((entry): LegacyRemovalVerifiedAbsentResult => {
      const present = check(entry);
      return { ...entry, present, absent: !present };
    });
    return {
      ...definition,
      evidence,
      verifiedAbsent,
      stillReferenced: evidence.some((entry) => entry.present),
      deleteAllowed: false,
    };
  });
  const countState = (state: LegacyRemovalState): number => items.filter((item) => item.state === state).length;
  const nextDeletion = items
    .filter((item) => item.candidatePriority.status === 'next-safe-candidate')
    .sort((a, b) => (a.candidatePriority.rank ?? Number.MAX_SAFE_INTEGER) - (b.candidatePriority.rank ?? Number.MAX_SAFE_INTEGER))[0];
  const planningNext = nextDeletion?.candidatePriority.nextScope
    ? {
        id: nextDeletion.id,
        title: nextDeletion.title,
        nextScope: nextDeletion.candidatePriority.nextScope,
        reason: nextDeletion.candidatePriority.reason,
        requiredBeforeDelete: nextDeletion.candidatePriority.blockedUntil ?? [],
        forbiddenScope: nextDeletion.candidatePriority.forbiddenScope ?? [],
      }
    : null;
  return {
    command: 'legacy-removal guard',
    guardVersion: 'FEAT-081A',
    dryRun: true,
    wouldDelete: false,
    physicalDeleteApproved: false,
    status: 'blocked',
    workspaceRoot: root,
    sidecarKeepAllowlist: SIDECAR_KEEP_ALLOWLIST,
    negativeScope: LEGACY_REMOVAL_NEGATIVE_SCOPE,
    summary: {
      total: items.length,
      keepCount: countState('keep'),
      freezeCount: countState('freeze'),
      deprecateCount: countState('deprecate'),
      removeCandidateCount: countState('remove-candidate'),
      stillReferencedCount: items.filter((item) => item.stillReferenced).length,
      deleteAllowedCount: 0,
      verifiedAbsentCount: items.reduce((sum, item) => sum + item.verifiedAbsent.length, 0),
      verifiedAbsentFailedCount: items.reduce((sum, item) => sum + item.verifiedAbsent.filter((entry) => !entry.absent).length, 0),
      nextSafeCandidateCount: items.filter((item) => item.candidatePriority.status === 'next-safe-candidate').length,
      blockedCandidateCount: items.filter((item) => item.candidatePriority.status === 'blocked').length,
      forbiddenCandidateCount: items.filter((item) => item.candidatePriority.status === 'forbidden').length,
    },
    planning: {
      stage: 'FEAT-081F',
      nextDeletionCandidate: planningNext,
      forbiddenCandidateIds: items.filter((item) => item.candidatePriority.status === 'forbidden').map((item) => item.id),
      blockedCandidateIds: items.filter((item) => item.candidatePriority.status === 'blocked').map((item) => item.id),
      completedPhysicalRemovals: items.flatMap((item) => item.physicalRemoval ? [{ id: item.id, candidate: item.physicalRemoval.candidate, removedBy: item.physicalRemoval.removedBy, rollbackPlan: item.physicalRemoval.rollbackPlan }] : []),
    },
    items,
    nextActions: [
      '本报告只读，不批准物理删除。',
      '删除前先处理 stillReferenced evidence，并提交影响面、回滚方案和验证结果。',
      'FEAT-081G 已摘线 channel setup/onboarding 默认执行路径；后续任何物理删除仍需另行单项批准。',
    ],
  };
}

export function formatLegacyRemovalGuardHuman(report: LegacyRemovalGuardReport): string {
  const lines = [
    'Haro legacy removal guard: dry-run',
    '结论：blocked；本报告不是删除批准。',
    `workspaceRoot: ${report.workspaceRoot}`,
    `wouldDelete: ${report.wouldDelete}`,
    `physicalDeleteApproved: ${report.physicalDeleteApproved}`,
    `items: total=${report.summary.total} freeze=${report.summary.freezeCount} deprecate=${report.summary.deprecateCount} removeCandidate=${report.summary.removeCandidateCount} stillReferenced=${report.summary.stillReferencedCount}`,
    `081F next deletion candidate: ${report.planning.nextDeletionCandidate ? `${report.planning.nextDeletionCandidate.id} scope=${report.planning.nextDeletionCandidate.nextScope}` : 'none'}`,
    `081F forbidden now: ${report.planning.forbiddenCandidateIds.join(',') || 'none'}`,
    `081F completed removals: ${report.planning.completedPhysicalRemovals.map((item) => `${item.candidate}:${item.removedBy}`).join(',') || 'none'}`,
    `verifiedAbsent: total=${report.summary.verifiedAbsentCount} failed=${report.summary.verifiedAbsentFailedCount}`,
    'negative scope:',
    ...report.negativeScope.map((item) => `- ${item}`),
    'guard items:',
    ...report.items.map((item) => {
      const present = item.evidence.filter((entry) => entry.present).length;
      const pilot = item.pilotUnbind
        ? ` pilotUnbind=${item.pilotUnbind.status}:${item.pilotUnbind.candidate}`
        : '';
      const removal = item.physicalRemoval
        ? ` physicalRemoval=${item.physicalRemoval.status}:${item.physicalRemoval.candidate}:${item.physicalRemoval.removedBy}`
        : '';
      const absent = item.verifiedAbsent.length > 0
        ? ` verifiedAbsent=${item.verifiedAbsent.filter((entry) => entry.absent).length}/${item.verifiedAbsent.length}`
        : '';
      const priority = ` priority=${item.candidatePriority.status}${item.candidatePriority.rank ? `#${item.candidatePriority.rank}` : ''}`;
      return `- ${item.id} [${item.state}] deleteAllowed=false evidence=${present}/${item.evidence.length}${absent}${priority}${pilot}${removal} decision=${item.decision}`;
    }),
    'next actions:',
    ...report.nextActions.map((action) => `- ${action}`),
  ];
  return `${lines.join('\n')}\n`;
}
