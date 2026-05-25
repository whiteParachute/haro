import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type LegacyRemovalState = 'keep' | 'freeze' | 'deprecate' | 'remove-candidate';
export type LegacyRemovalEvidenceKind = 'exists' | 'contains';

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
  pilotUnbind?: {
    candidate: string;
    status: 'default-path-unbound';
    note: string;
  };
  evidence: LegacyRemovalEvidenceDefinition[];
}

export interface LegacyRemovalEvidenceResult extends LegacyRemovalEvidenceDefinition {
  present: boolean;
}

export interface LegacyRemovalGuardItem extends Omit<LegacyRemovalGuardDefinition, 'evidence'> {
  evidence: LegacyRemovalEvidenceResult[];
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
  '物理删除 package/module/file',
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
      '移除 CLI channel setup 主路径依赖',
      '确认 AgentDock IM 已承接生产消息通道',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/channel test', 'pnpm -F @haro/cli test:legacy'],
    decision: '保持 deprecate/freeze；本轮不删除。',
    evidence: [
      { path: 'packages/channel/package.json', kind: 'exists', description: 'channel package 仍存在' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'registerChannelCommands', description: 'CLI 仍注册 channel 入口' },
      { path: 'packages/mcp-tools/src/tools/send-message.ts', kind: 'exists', description: 'MCP legacy send_message tool 仍存在' },
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
    decision: '保持 freeze；FEAT-081B 仅解绑 team-orchestrator 默认执行路径，不删除文件。',
    pilotUnbind: {
      candidate: 'packages/core/src/team-orchestrator.ts',
      status: 'default-path-unbound',
      note: '默认 haro run 不再执行 TeamOrchestrator；只有显式 HARO_ENABLE_LEGACY_TEAM_ORCHESTRATOR=1 才走兼容路径。',
    },
    evidence: [
      { path: 'packages/core/src/team-orchestrator.ts', kind: 'exists', description: 'team orchestrator 文件仍存在' },
      { path: 'packages/core/src/scenario-router.ts', kind: 'exists', description: 'scenario router 文件仍存在' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'ScenarioRouter', description: 'CLI bootstrap 仍构造/引用 scenario router' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'HARO_ENABLE_LEGACY_TEAM_ORCHESTRATOR', description: 'team orchestrator 默认执行路径已改为显式 legacy env' },
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
    const evidence = definition.evidence.map((entry): LegacyRemovalEvidenceResult => {
      const absolute = join(root, entry.path);
      const present = entry.kind === 'exists'
        ? existsSync(absolute)
        : existsSync(absolute) && readFileSync(absolute, 'utf8').includes(entry.pattern ?? '');
      return { ...entry, present };
    });
    return {
      ...definition,
      evidence,
      stillReferenced: evidence.some((entry) => entry.present),
      deleteAllowed: false,
    };
  });
  const countState = (state: LegacyRemovalState): number => items.filter((item) => item.state === state).length;
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
    },
    items,
    nextActions: [
      '本报告只读，不批准物理删除。',
      '删除前先处理 stillReferenced evidence，并提交影响面、回滚方案和验证结果。',
      'FEAT-081B 才能按单项候选评审是否解除 export/import 或进入 archive。',
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
    'negative scope:',
    ...report.negativeScope.map((item) => `- ${item}`),
    'guard items:',
    ...report.items.map((item) => {
      const present = item.evidence.filter((entry) => entry.present).length;
      const pilot = item.pilotUnbind
        ? ` pilotUnbind=${item.pilotUnbind.status}:${item.pilotUnbind.candidate}`
        : '';
      return `- ${item.id} [${item.state}] deleteAllowed=false evidence=${present}/${item.evidence.length}${pilot} decision=${item.decision}`;
    }),
    'next actions:',
    ...report.nextActions.map((action) => `- ${action}`),
  ];
  return `${lines.join('\n')}\n`;
}
