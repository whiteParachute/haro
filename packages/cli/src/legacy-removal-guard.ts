import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type LegacyRemovalState = 'keep' | 'freeze' | 'deprecate' | 'remove-candidate';
export type LegacyRemovalEvidenceKind = 'exists' | 'contains';
export type LegacyCandidatePriorityStatus = 'done' | 'next-safe-candidate' | 'blocked' | 'forbidden' | 'defer';
export type LegacyModuleRetirementStatus = 'retire-candidate' | 'deferred' | 'keep';

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

export interface LegacyPhysicalRemovalRecord {
  candidate: string;
  status: 'physically-removed';
  removedBy: 'FEAT-081D' | 'FEAT-081E' | 'FEAT-081H' | 'FEAT-081J';
  rollbackPlan: string;
  note: string;
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
  physicalRemoval?: LegacyPhysicalRemovalRecord;
  physicalRemovals?: LegacyPhysicalRemovalRecord[];
  evidence: LegacyRemovalEvidenceDefinition[];
  verifiedAbsent?: LegacyRemovalEvidenceDefinition[];
}

export interface LegacyModuleRetirementBoundary {
  module: 'channel-message' | 'provider' | 'memory' | 'run-router-runtime-scenario' | 'skills' | 'web-api';
  status: LegacyModuleRetirementStatus;
  owner: string;
  haroRetireScope: string[];
  protectedScope: string[];
  decision: string;
  nextAction: string;
  deletionCandidateAllowed: boolean;
  deferredUntil?: string[];
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
    stage: 'FEAT-081J';
    lastCompletedStage: 'FEAT-081J';
    lastUpdatedBy: 'FEAT-081J';
    moduleRetirementBoundaries: LegacyModuleRetirementBoundary[];
    nextDeletionCandidate: {
      id: string;
      title: string;
      nextScope: string;
      reason: string;
      requiredBeforeDelete: string[];
      forbiddenScope: string[];
    } | null;
    nextReviewCandidate: {
      id: string;
      title: string;
      reviewScope: string;
      reviewPurpose: string;
      reason: string;
      notApproval: true;
      requiredBeforeDelete: string[];
      forbiddenScope: string[];
    } | null;
    forbiddenCandidateIds: string[];
    blockedCandidateIds: string[];
    deferredCandidateIds: string[];
    completedPhysicalRemovals: Array<{ id: string; candidate: string; removedBy: 'FEAT-081D' | 'FEAT-081E' | 'FEAT-081H' | 'FEAT-081J'; rollbackPlan: string }>;
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

export const LEGACY_MODULE_RETIREMENT_BOUNDARIES: LegacyModuleRetirementBoundary[] = [
  {
    module: 'channel-message',
    status: 'retire-candidate',
    owner: 'AgentDock',
    haroRetireScope: [
      'Haro-owned channel packages',
      '旧 haro channel CLI/配置链路',
      'Haro 自有 Feishu/Telegram onboarding 管理面',
    ],
    protectedScope: [
      'packages/mcp-tools/src/tools/send-message.ts',
      'AgentDock 生产消息能力',
      '真实 Feishu/Telegram IM 投递链路',
    ],
    decision: 'Haro 只保留 MCP send_message 这类对外工具；真实 channel 管理由 AgentDock 提供。',
    nextAction: '优先把 channel-layer 继续作为下一单项评审候选，但评审范围必须排除 MCP send_message 与 AgentDock 生产消息。',
    deletionCandidateAllowed: true,
  },
  {
    module: 'provider',
    status: 'retire-candidate',
    owner: 'AgentDock / ModelHub',
    haroRetireScope: ['packages/provider-codex', 'Haro provider bootstrap/onboarding'],
    protectedScope: ['后续 LLM draft 所需的 AgentDock provider bridge'],
    decision: 'provider 由 AgentDock 提供；Haro 自带 provider-codex/provider bootstrap 进入退役候选。',
    nextAction: '先补 AgentDock/ModelHub provider bridge 证据，再单项评审 Haro provider-codex 删除。',
    deletionCandidateAllowed: true,
  },
  {
    module: 'memory',
    status: 'retire-candidate',
    owner: 'aria-memory-vault / AgentDock memory',
    haroRetireScope: ['packages/core/src/memory', 'packages/cli/src/commands/memory.ts', 'Haro-owned MemoryFabric'],
    protectedScope: ['真实 ~/.haro 数据', 'aria-memory vault', 'AgentDock/aria-memory 共享记忆'],
    decision: 'memory 统一走共享 aria-memory-vault；Haro 自有 MemoryFabric 进入退役候选。',
    nextAction: '删除前必须先证明不会误删真实 ~/.haro 或 aria-memory vault 数据。',
    deletionCandidateAllowed: true,
  },
  {
    module: 'run-router-runtime-scenario',
    status: 'deferred',
    owner: '待 AgentDock scheduler / runner 稳定性验证后再定',
    haroRetireScope: ['packages/core/src/agent', 'packages/core/src/runtime', 'packages/core/src/scenario-router.ts', '旧 haro run/chat/team/scenario 路径'],
    protectedScope: ['AgentDock 定时任务 -> Haro 提案生成 -> 待审请求 -> Review Board 可审 的主链路验证前，不得删除'],
    decision: 'run/router/runtime/scenario-router 本轮 deferred；081I 不得把第 4 项列为下一删除候选。',
    nextAction: '等 AgentDock 定时任务稳定触发 Haro 提案生成并可在 Review Board 人审后，再判断是否退役。',
    deletionCandidateAllowed: false,
    deferredUntil: [
      'AgentDock 定时任务稳定触发 Haro 生成提案',
      'Haro 创建待审 approval request',
      'Review Board 可审',
      '证明链路不依赖旧 haro run/chat/team/scenario',
    ],
  },
  {
    module: 'skills',
    status: 'retire-candidate',
    owner: 'AgentDock skills',
    haroRetireScope: ['packages/skills', 'skills marketplace/manager legacy surface'],
    protectedScope: ['必要 eat/shit 兼容语义', '已落 Haro sidecar artifact 的资产引用'],
    decision: 'skills 由 AgentDock 提供；Haro 旧 skills marketplace/legacy skills 进入退役候选，但要保留必要兼容说明。',
    nextAction: '先拆清 marketplace 与必要兼容资产，再做单项删除评审。',
    deletionCandidateAllowed: true,
  },
  {
    module: 'web-api',
    status: 'retire-candidate',
    owner: 'Haro Review Board + AgentDock Web',
    haroRetireScope: ['Review Board 之外的旧 dashboard/API'],
    protectedScope: ['approval review board routes', 'packages/web-api/src/routes/approval-requests.ts'],
    decision: 'Web/API 仅保留 Review Board/审批看板；看板外旧 dashboard/API 进入退役候选。',
    nextAction: '只允许逐路由评审非 Review Board surface；不得包级删除 Web/API。',
    deletionCandidateAllowed: true,
  },
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
    decision: 'provider 由 AgentDock 提供；Haro provider-codex/provider bootstrap 进入退役候选，但本轮不删除。',
    candidatePriority: {
      status: 'blocked',
      rank: 4,
      reason: 'provider-codex 的退役方向已明确，但仍被 CLI bootstrap 与后续 LLM draft/provider 能力引用。',
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
    replacement: 'AgentDock IM / channel layer；Haro 仅保留 MCP send_message 对外工具',
    blockingDependencies: [
      '确认 MCP send_message 是保留工具而不是 channel package 删除范围',
      'FEAT-081H 已物理删除 CLI channel setup/onboarding removed stub',
      'FEAT-081J 已物理删除 CLI channel config 管理命令与 adapter setup contract',
      '确认 AgentDock IM 已承接生产消息通道',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/channel test', 'pnpm -F @haro/cli test:legacy'],
    decision: 'channel/消息边界已固化：真实 Feishu/Telegram/channel 管理由 AgentDock 提供，Haro 只保留 MCP send_message；FEAT-081J 已删除 CLI config 管理和 adapter setup contract，剩余 channel package 删除仍需后续单项评审。',
    candidatePriority: {
      status: 'next-safe-candidate',
      rank: 1,
      nextScope: 'channel-layer / replace @haro/channel dependency for MCP send_message, then review packages/channel* removal',
      reason: 'FEAT-081J 已删除 CLI config 管理、disabled adapter autoload 与 adapter setup contract；剩余 channel packages 仍被 MCP send_message/types 引用，下一步只能先替换该依赖后再评审删除。',
      blockedUntil: ['提交 @haro/channel 在 mcp-tools 中的替代方案', '证明 MCP send_message 与 Feishu/Telegram 生产消息路径不受影响', '确认 AgentDock IM 已承接相关 channel 管理/onboarding 流程'],
      forbiddenScope: ['packages/mcp-tools/src/tools/send-message.ts', 'AgentDock 生产消息能力', '真实 Feishu/Telegram IM 投递链路'],
    },
    physicalRemoval: {
      candidate: 'packages/cli/src/gateway.ts',
      status: 'physically-removed',
      removedBy: 'FEAT-081E',
      rollbackPlan: 'git revert FEAT-081E commit 可恢复 gateway 源码、legacy env 注册路径和旧 gateway 测试。',
      note: '仅 gateway 旧 CLI daemon/control-plane 入口被删除；channel/provider/memory/skills/Web/scenario-router 未获物理删除批准。',
    },
    physicalRemovals: [
      {
        candidate: 'packages/cli/src/index.ts#channel-setup-onboarding-stub',
        status: 'physically-removed',
        removedBy: 'FEAT-081H',
        rollbackPlan: 'git revert FEAT-081H commit 可恢复 channel setup/onboarding removed stub 与对应测试。',
        note: '仅删除 081G removed/fail-closed stub 与 onboarding alias；packages/channel、Feishu/Telegram channel、MCP send_message 未获物理删除批准。',
      },
      {
        candidate: 'packages/cli/src/index.ts#channel-config-management-commands',
        status: 'physically-removed',
        removedBy: 'FEAT-081J',
        rollbackPlan: 'git revert FEAT-081J commit 可恢复 channel enable/disable/remove config mutation commands、disabled adapter autoload 与相关测试。',
        note: '仅删除 Haro-owned channel CLI config 管理路径；channel list/doctor、MCP send_message 和 enabled channel runtime 仍保留。',
      },
      {
        candidate: 'packages/channel*/src#setup-contract',
        status: 'physically-removed',
        removedBy: 'FEAT-081J',
        rollbackPlan: 'git revert FEAT-081J commit 可恢复 ChannelSetupResult、ManagedChannel.setup 和 Feishu/Telegram setup 方法。',
        note: '仅删除旧 onboarding/setup contract；Feishu/Telegram start/send/doctor 与 @haro/channel registry 仍保留。',
      },
    ],
    evidence: [
      { path: 'packages/channel/package.json', kind: 'exists', description: 'channel package 仍存在，不在 081E 删除范围' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'registerChannelCommands', description: 'CLI 仍注册 channel 入口' },
      { path: 'packages/mcp-tools/src/tools/send-message.ts', kind: 'exists', description: 'MCP legacy send_message tool 仍存在' },
    ],
    verifiedAbsent: [
      { path: 'packages/cli/src/gateway.ts', kind: 'exists', description: 'gateway 旧 CLI daemon 源文件已由 FEAT-081E 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: "HARO_ENABLE_LEGACY_GATEWAY_COMMANDS === '1'", description: 'gateway legacy env 注册判断已由 FEAT-081E 移除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'LEGACY_CHANNEL_ONBOARDING_REMOVED', description: 'channel onboarding removed stub code 已由 FEAT-081H 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'renderRemovedOnboarding', description: 'channel onboarding removed helper 已由 FEAT-081H 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: ".command('onboarding')", description: 'channel onboarding alias 已由 FEAT-081H 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'entry.channel.setup(createChannelSetupContext', description: 'channel setup/onboarding 不再调用旧 channel.setup 实现' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'updateChannelConfig(app, id, { ...result.config, enabled: true })', description: 'channel setup/onboarding 不再写入 channel config' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: "Channel '${entry.id}' enabled", description: 'channel enable config 管理命令已由 FEAT-081J 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: "Channel '${entry.id}' disabled", description: 'channel disable config 管理命令已由 FEAT-081J 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: "Channel '${entry.id}' removed", description: 'channel remove config 管理命令已由 FEAT-081J 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'updateChannelConfig', description: 'channel config 写入 helper 已由 FEAT-081J 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'removeChannelConfig', description: 'channel config 删除 helper 已由 FEAT-081J 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: "firstArg === 'channel'", description: 'haro channel 命令触发 disabled adapter autoload 已由 FEAT-081J 删除' },
      { path: 'packages/channel/src/protocol.ts', kind: 'contains', pattern: 'ChannelSetupResult', description: 'channel setup result contract 已由 FEAT-081J 删除' },
      { path: 'packages/channel/src/protocol.ts', kind: 'contains', pattern: 'setup?(ctx', description: 'ManagedChannel.setup contract 已由 FEAT-081J 删除' },
      { path: 'packages/channel-feishu/src/feishu-channel.ts', kind: 'contains', pattern: 'async setup(ctx', description: 'Feishu setup/onboarding 方法已由 FEAT-081J 删除' },
      { path: 'packages/channel-telegram/src/telegram-channel.ts', kind: 'contains', pattern: 'async setup(ctx', description: 'Telegram setup/onboarding 方法已由 FEAT-081J 删除' },
    ],
  },
  {
    id: 'memory-fabric',
    title: 'MemoryFabric / Haro-owned memory',
    category: 'core-export',
    state: 'deprecate',
    candidatePaths: ['packages/core/src/memory', 'packages/cli/src/commands/memory.ts'],
    replacement: '共享 aria-memory-vault / AgentDock memory',
    blockingDependencies: [
      '移除 core barrel MemoryFabric export',
      '确认 mcp-tools memory_* legacy registry 已隔离',
      '确认 sidecar 主链路不读写 Haro-owned memory',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/core test:legacy', 'pnpm -F @haro/cli test:legacy'],
    decision: 'memory 统一走共享 aria-memory-vault；Haro MemoryFabric 进入退役候选，但真实 memory 数据不在删除范围。',
    candidatePriority: {
      status: 'blocked',
      rank: 5,
      reason: 'Haro-owned memory 退役方向已明确，但牵涉真实 ~/.haro 数据、aria-memory vault 和 MCP memory tools，删除前必须先完成数据/owner 边界验证。',
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
    replacement: '待 AgentDock scheduler / runner 稳定性验证后再定',
    blockingDependencies: [
      'AgentDock 定时任务稳定触发 Haro 生成提案',
      'Haro 创建待审 approval request',
      'Review Board 可审且不依赖旧 haro run/chat/team/scenario',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/core test:legacy', 'pnpm -F @haro/cli test:legacy'],
    decision: 'FEAT-081D 已物理删除 TeamOrchestrator 旧兼容路径；run/router/runtime/scenario-router 本轮 deferred，未批准删除，也不得作为下一删除候选。',
    candidatePriority: {
      status: 'defer',
      rank: 6,
      nextScope: 'deferred until AgentDock scheduled proposal chain is stable',
      reason: '第 4 项按用户边界 deferred；先删其它，等 AgentDock 定时任务能稳定触发 Haro 提案生成并进入 Review Board 后再评估。',
      blockedUntil: ['AgentDock 定时任务稳定触发 Haro 生成提案', 'Haro 创建待审请求', 'Review Board 可审', '证明不依赖旧 haro run/chat/team/scenario'],
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
    replacement: 'AgentDock skills / Haro sidecar artifacts',
    blockingDependencies: [
      '确认 sidecar 主链路不依赖 packages/skills',
      '保留或迁移 eat/shit 资产语义',
      'legacy tests 分类稳定',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/skills test', 'pnpm -F @haro/cli test:legacy'],
    decision: 'skills 由 AgentDock 提供；Haro 旧 skills marketplace/legacy skills 进入退役候选，但需要保留必要兼容说明。',
    candidatePriority: {
      status: 'defer',
      rank: 3,
      reason: 'packages/skills 仍承载 eat/shit 兼容流程；可后续先评审 marketplace 扩展面，但不应删除必要兼容资产。',
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
    replacement: 'Haro Web 只保留 proposal review board；通用 dashboard/API 由 AgentDock 承接',
    blockingDependencies: [
      '列出 review board endpoint allowlist',
      '确认 provider/channel/runtime 页面不在主入口',
      'Web/API 路由删除需单独批准',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/web-api test', 'pnpm -F @haro/web build'],
    decision: 'Web/API 仅保留 Review Board/审批看板；看板外旧 dashboard/API 可进入退役候选，但不得包级删除 Web/API。',
    candidatePriority: {
      status: 'blocked',
      rank: 5,
      reason: 'Review Board 是 Haro sidecar 主链路看板，Web/API 包级删除被禁止；看板外旧 dashboard/API 只能逐路由评审。',
      blockedUntil: ['列出 Review Board endpoint allowlist', '列出非 review dashboard/API 路由', '逐路由证明删除不影响审批看板'],
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
  const reviewCandidate = nextDeletion ?? items
    .filter((item) => item.candidatePriority.status === 'defer' && item.candidatePriority.nextScope)
    .sort((a, b) => (a.candidatePriority.rank ?? Number.MAX_SAFE_INTEGER) - (b.candidatePriority.rank ?? Number.MAX_SAFE_INTEGER))[0];
  const nextReviewCandidate = reviewCandidate?.candidatePriority.nextScope
    ? {
        id: reviewCandidate.id,
        title: reviewCandidate.title,
        reviewScope: reviewCandidate.candidatePriority.nextScope,
        reviewPurpose: reviewCandidate.id === 'channel-layer' ? 'single-module-retirement-review' : 'pre-deletion-review',
        reason: reviewCandidate.id === 'channel-layer'
          ? '081I 按用户最新边界把 channel-layer 选为下一项可执行删除评审候选；这不是删除授权。下一阶段必须证明不影响 MCP send_message、AgentDock 生产消息和真实 Feishu/Telegram 投递。'
          : `${reviewCandidate.title} 仅作为后续评审候选，不是删除授权。`,
        notApproval: true as const,
        requiredBeforeDelete: reviewCandidate.candidatePriority.blockedUntil ?? [],
        forbiddenScope: reviewCandidate.candidatePriority.forbiddenScope ?? [],
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
      stage: 'FEAT-081J',
      lastCompletedStage: 'FEAT-081J',
      lastUpdatedBy: 'FEAT-081J',
      moduleRetirementBoundaries: LEGACY_MODULE_RETIREMENT_BOUNDARIES,
      nextDeletionCandidate: planningNext,
      nextReviewCandidate,
      forbiddenCandidateIds: items.filter((item) => item.candidatePriority.status === 'forbidden').map((item) => item.id),
      blockedCandidateIds: items.filter((item) => item.candidatePriority.status === 'blocked').map((item) => item.id),
      deferredCandidateIds: items.filter((item) => item.candidatePriority.status === 'defer').map((item) => item.id),
      completedPhysicalRemovals: items.flatMap((item) => [
        ...(item.physicalRemoval ? [{ id: item.id, candidate: item.physicalRemoval.candidate, removedBy: item.physicalRemoval.removedBy, rollbackPlan: item.physicalRemoval.rollbackPlan }] : []),
        ...(item.physicalRemovals ?? []).map((removal) => ({ id: item.id, candidate: removal.candidate, removedBy: removal.removedBy, rollbackPlan: removal.rollbackPlan })),
      ]),
    },
    items,
    nextActions: [
      '本报告只读，不批准物理删除。',
      '081I 固化模块级退役边界：channel/provider/memory/skills/Web 非主线面由 AgentDock 或共享能力承接；run/router/runtime/scenario 本轮 deferred。',
      '081J 已删除 Haro-owned channel CLI config 管理命令、disabled adapter autoload 和 adapter setup contract。',
      '下一项评审候选仍是 channel-layer；必须先替换 @haro/channel 在 MCP send_message/types 中的依赖，且排除 AgentDock 生产消息能力。',
      '删除前先处理 stillReferenced evidence，并提交影响面、回滚方案和验证结果。',
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
    `planning stage: ${report.planning.stage} lastCompleted=${report.planning.lastCompletedStage}`,
    `next deletion candidate (candidate only, not approval): ${report.planning.nextDeletionCandidate ? `${report.planning.nextDeletionCandidate.id} scope=${report.planning.nextDeletionCandidate.nextScope}` : 'none'}`,
    `next review candidate: ${report.planning.nextReviewCandidate ? `${report.planning.nextReviewCandidate.id} scope=${report.planning.nextReviewCandidate.reviewScope} notApproval=${report.planning.nextReviewCandidate.notApproval}` : 'none'}`,
    `forbidden now: ${report.planning.forbiddenCandidateIds.join(',') || 'none'}`,
    `deferred now: ${report.planning.deferredCandidateIds.join(',') || 'none'}`,
    `completed removals: ${report.planning.completedPhysicalRemovals.map((item) => `${item.candidate}:${item.removedBy}`).join(',') || 'none'}`,
    `verifiedAbsent: total=${report.summary.verifiedAbsentCount} failed=${report.summary.verifiedAbsentFailedCount}`,
    'module retirement boundaries:',
    ...report.planning.moduleRetirementBoundaries.map((boundary) => `- ${boundary.module} status=${boundary.status} owner=${boundary.owner} deletionCandidateAllowed=${boundary.deletionCandidateAllowed} decision=${boundary.decision}`),
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
      const extraRemovals = item.physicalRemovals && item.physicalRemovals.length > 0
        ? ` physicalRemovals=${item.physicalRemovals.map((entry) => `${entry.status}:${entry.candidate}:${entry.removedBy}`).join(',')}`
        : '';
      const absent = item.verifiedAbsent.length > 0
        ? ` verifiedAbsent=${item.verifiedAbsent.filter((entry) => entry.absent).length}/${item.verifiedAbsent.length}`
        : '';
      const priority = ` priority=${item.candidatePriority.status}${item.candidatePriority.rank ? `#${item.candidatePriority.rank}` : ''}`;
      return `- ${item.id} [${item.state}] deleteAllowed=false evidence=${present}/${item.evidence.length}${absent}${priority}${pilot}${removal}${extraRemovals} decision=${item.decision}`;
    }),
    'next actions:',
    ...report.nextActions.map((action) => `- ${action}`),
  ];
  return `${lines.join('\n')}\n`;
}
