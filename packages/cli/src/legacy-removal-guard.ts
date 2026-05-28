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
  removedBy: 'FEAT-081D' | 'FEAT-081E' | 'FEAT-081H' | 'FEAT-081J' | 'FEAT-081L' | 'FEAT-081O' | 'FEAT-081P' | 'FEAT-081R' | 'FEAT-081S' | 'FEAT-081U' | 'FEAT-081V' | 'FEAT-081X';
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
    stage: 'FEAT-081X';
    lastCompletedStage: 'FEAT-081X';
    lastUpdatedBy: 'FEAT-081X';
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
    completedPhysicalRemovals: Array<{ id: string; candidate: string; removedBy: 'FEAT-081D' | 'FEAT-081E' | 'FEAT-081H' | 'FEAT-081J' | 'FEAT-081L' | 'FEAT-081O' | 'FEAT-081P' | 'FEAT-081R' | 'FEAT-081S' | 'FEAT-081U' | 'FEAT-081V' | 'FEAT-081X'; rollbackPlan: string }>;
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
    nextAction: 'FEAT-081L 已删除 Haro-owned channel packages 与 CLI list/doctor；后续如继续减法需重新排序其它模块，仍不得触碰 MCP send_message 与 AgentDock 生产消息。',
    deletionCandidateAllowed: false,
  },
  {
    module: 'provider',
    status: 'retire-candidate',
    owner: 'AgentDock / ModelHub',
    haroRetireScope: ['packages/provider-codex', 'Haro provider bootstrap/onboarding', 'standalone haro provider CLI management surface'],
    protectedScope: ['packages/provider-codex runtime', 'createCodexProvider / readLocalCodexAuth', 'diagnostics provider stage 与 run/chat/LLM provider path'],
    decision: '用户 2026-05-28 产品决策要求仅保留当前产品必要基本功能；FEAT-081X 退役 standalone haro provider CLI 管理面，AgentDock/ModelHub 承接 provider 管理 owner；不批准删除 provider-codex runtime。',
    nextAction: '后续若继续 provider 减法，只能在证明 provider runtime、diagnostics provider stage、Review Board/sidecar LLM 路径均无业务引用后另开单项评审；当前保持 provider-codex package/runtime fail-closed protected。',
    deletionCandidateAllowed: false,
  },
  {
    module: 'memory',
    status: 'retire-candidate',
    owner: 'aria-memory-vault / AgentDock memory',
    haroRetireScope: ['packages/core/src/memory', 'packages/cli/src/commands/memory.ts', 'Haro-owned MemoryFabric'],
    protectedScope: ['真实 ~/.haro 数据', 'aria-memory vault', 'AgentDock/aria-memory 共享记忆'],
    decision: 'memory 方向应收口到共享 aria-memory-vault / AgentDock memory；FEAT-081U 只删除 haro run --legacy-memory CLI opt-in wiring，不触碰真实 ~/.haro 数据、aria-memory vault、MCP memory_* 默认注册或 core MemoryFabric runtime。',
    nextAction: '继续证明 sidecar 主链路不读写 Haro-owned memory，并隔离 memory_query read path 与真实数据边界；不得把 081U/081X-F2 解读为 MemoryFabric/runtime 删除批准。',
    deletionCandidateAllowed: false,
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
    decision: 'skills 由 AgentDock 提供；FEAT-081V 仅将 marketplace:<name> 占位安装语义 retired/fail-closed，不批准 packages/skills、SkillsManager、local/git install、eat/shit 或 sync-runtime 删除。',
    nextAction: '继续保持 skills-marketplace freeze/defer；若后续评审 packages/skills 或 SkillsManager，必须先证明 local/git/eat/shit/sync-runtime/prepareTask 与 AgentDock skills owner 边界。',
    deletionCandidateAllowed: false,
  },
  {
    module: 'web-api',
    status: 'retire-candidate',
    owner: 'Haro Review Board + AgentDock Web',
    haroRetireScope: ['Review Board 之外的旧 dashboard/API'],
    protectedScope: ['approval review board routes', 'packages/web-api/src/routes/approval-requests.ts'],
    decision: 'FEAT-081T 已完成 Review Board allowlist 与非 review Web/API 路由枚举：非 review surface 为空；Web/API 只保留 Review Board + auth/bootstrap + health/fallback/infrastructure，不批准 runtime/Web/API 删除。',
    nextAction: '继续保持 Web/API freeze/allowlist；不得从 081T 推导 packages/web 或 packages/web-api 包级删除批准，后续如出现新路由需单项评审。',
    deletionCandidateAllowed: false,
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
      'FEAT-081N 已退役 provider setup/onboarding CLI 入口',
      'FEAT-081O 已删除 setup-only provider-codex wizard dead file',
      'FEAT-081P 已删除旧 provider setup --write-env-file 写入 helper',
      'FEAT-081R 已删除 provider setup retired 子命令 stub',
      'FEAT-081X 已退役 standalone haro provider CLI 管理面',
      'provider-codex runtime 仍被 CLI bootstrap/run/chat/LLM path 引用',
      'diagnostics provider stage 与 sidecar/review/run/chat LLM provider path 仍需保护',
      '删除 provider runtime 前仍需证明 createCodexProvider/readLocalCodexAuth/import 影响面清零',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/provider-codex test', 'pnpm -F @haro/cli test:legacy'],
    decision: 'FEAT-081X 只退役 standalone haro provider CLI 管理面；provider-codex package/runtime、diagnostics provider stage 和 run/chat/LLM provider path 继续保留且不获删除批准。',
    candidatePriority: {
      status: 'blocked',
      rank: 4,
      reason: 'provider setup/onboarding 子面与 standalone provider CLI 管理面已摘线，但 provider-codex runtime 仍承担默认 provider 与 sidecar/review/run/chat/LLM path；不得把 081X 解读为 package/runtime 删除完成。',
      blockedUntil: ['证明 provider-codex runtime 无业务引用', 'LLM draft/review provider path 完成替代验证', '确认 diagnostics provider stage 不依赖待删 runtime', '确认 createCodexProvider/readLocalCodexAuth/import 影响面清零'],
    },
    pilotUnbind: {
      candidate: 'packages/cli/src/index.ts#provider-setup-onboarding-command',
      status: 'default-path-unbound',
      note: 'FEAT-081N 将 haro provider setup ... 改为 retired/fail-closed；FEAT-081O 删除 provider-codex-wizard setup-only 文件；FEAT-081P 删除 writeProviderEnvFile setup writer；FEAT-081R 删除 provider setup retired 子命令 stub；不调用 runCodexAuthWizard、writeProviderConfig、writeProviderEnvFile 或 runProviderDoctor setup flow。',
    },
    physicalRemovals: [
      {
        candidate: 'packages/cli/src/provider-codex-wizard.ts',
        status: 'physically-removed',
        removedBy: 'FEAT-081O',
        rollbackPlan: 'git revert FEAT-081O commit 可恢复 provider setup-only wizard 源文件与旧单元测试。',
        note: '仅删除 081N 后无业务入口的 setup-only Codex auth wizard；provider-codex package/runtime、readLocalCodexAuth、createCodexProvider 和 provider doctor/list/models/select/env 均保留。',
      },
      {
        candidate: 'packages/cli/src/provider-onboarding.ts#writeProviderEnvFile',
        status: 'physically-removed',
        removedBy: 'FEAT-081P',
        rollbackPlan: 'git revert FEAT-081P commit 可恢复旧 provider setup --write-env-file helper 与 env-file writer 代码。',
        note: '仅删除 081N/P 后无业务入口的 setup env-file 写入 helper；ProviderEnvFileSummary/readProviderEnvFileSummary/resolveProviderEnvFile 当时继续服务 provider 管理面与 diagnostics，081X 后 standalone CLI 管理面退役但 provider runtime/diagnostics 仍保留。',
      },
      {
        candidate: 'packages/cli/src/index.ts#provider-setup-retired-stub',
        status: 'physically-removed',
        removedBy: 'FEAT-081R',
        rollbackPlan: 'git revert FEAT-081R commit 可恢复 provider setup fail-closed stub 代码。',
        note: '删除 081N 引入的 provider setup fail-closed stub；移除后 provider setup 变为未注册子命令，仍维持 fail-closed 且不会进入 REPL。',
      },
      {
        candidate: 'packages/cli/src/index.ts#provider-cli-management-surface',
        status: 'physically-removed',
        removedBy: 'FEAT-081X',
        rollbackPlan: 'git revert FEAT-081X commit 可恢复 standalone haro provider CLI list/doctor/models/select/env 管理面注册与测试。',
        note: '仅退役 standalone haro provider CLI 管理 surface；不删除 packages/provider-codex runtime、createCodexProvider/readLocalCodexAuth、diagnostics provider stage 或 sidecar/review/run/chat LLM provider path。',
      },
    ],
    evidence: [
      { path: 'packages/provider-codex/package.json', kind: 'exists', description: 'provider package 仍存在' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'createCodexProvider', description: 'CLI bootstrap 仍引用 Codex provider runtime' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'PROVIDER_CLI_RETIRED_MESSAGE', description: 'standalone provider CLI management surface 已由 FEAT-081X 统一 fail-closed retired' },
      { path: 'packages/cli/src/diagnostics.ts', kind: 'contains', pattern: 'runProviderDoctor', description: 'diagnostics provider stage 仍保留 provider runtime 检查入口' },
      { path: 'packages/cli/package.json', kind: 'contains', pattern: '@haro/provider-codex', description: 'CLI package dependency 仍存在' },
    ],
    verifiedAbsent: [
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'PROVIDER_SETUP_RETIRED', description: 'provider setup retired stub marker 已由 FEAT-081R 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'Haro provider setup/onboarding has been retired in FEAT-081N', description: 'provider setup retired stub message 已由 FEAT-081R 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'runCodexAuthWizard', description: 'provider setup 不再调用 Codex auth wizard' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'writeProviderEnvFile', description: 'provider setup 不再调用 provider env file writer' },
      { path: 'packages/cli/src/provider-onboarding.ts', kind: 'contains', pattern: 'writeProviderEnvFile', description: 'provider setup env-file writer helper 已由 FEAT-081P 删除' },
      { path: 'packages/cli/src/provider-onboarding.ts', kind: 'contains', pattern: 'ProviderEnvFileWriteResult', description: 'ProviderEnvFileWriteResult provider setup env-file writer result type 已由 FEAT-081P 删除' },
      { path: 'packages/cli/src/provider-onboarding.ts', kind: 'contains', pattern: 'renameSync', description: 'renameSync 旧 env-file writer 原子替换 import 已由 FEAT-081P 删除' },
      { path: 'packages/cli/src/provider-onboarding.ts', kind: 'contains', pattern: 'chmodSync', description: 'chmodSync 旧 env-file writer chmod import 已由 FEAT-081P 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'formatProviderSetupHuman', description: 'provider setup 成功输出路径已退役' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'provider setup ${id} found blockers', description: 'provider setup 不再进入 doctor/blocker 流程' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'formatProviderList', description: 'standalone provider list formatter 已由 FEAT-081X 从 CLI 管理面摘线' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'formatProviderDoctorHuman', description: 'standalone provider doctor human formatter 已由 FEAT-081X 从 CLI 管理面摘线' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'formatProviderEnvHuman', description: 'standalone provider env formatter 已由 FEAT-081X 从 CLI 管理面摘线' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'listProviderModels', description: 'standalone provider models helper 已由 FEAT-081X 从 CLI 管理面摘线' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'writeProviderConfig', description: 'standalone provider select config writer 已由 FEAT-081X 从 CLI 管理面摘线' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'parseProviderScope', description: 'standalone provider select scope parser 已由 FEAT-081X 从 CLI 管理面摘线' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'runProviderDoctor({', description: 'standalone provider doctor command no longer calls runProviderDoctor from CLI management surface' },
      { path: 'packages/cli/src/provider-codex-wizard.ts', kind: 'exists', description: 'setup-only provider-codex wizard 源文件已由 FEAT-081O 删除' },
      { path: 'packages/cli/test/provider-codex-wizard.test.ts', kind: 'exists', description: 'setup-only provider-codex wizard 单元测试已由 FEAT-081O 删除' },
      { path: 'packages/cli/package.json', kind: 'contains', pattern: 'provider-codex-wizard.test.ts', description: 'CLI legacy test script 不再引用已删除 wizard 测试' },
      { path: 'packages/cli/src/provider-codex-wizard.ts', kind: 'contains', pattern: 'runProviderSetupWizard', description: 'setup wizard runProviderSetupWizard 符号已随文件删除' },
      { path: 'packages/cli/src/provider-codex-wizard.ts', kind: 'contains', pattern: 'runChatGptLogin', description: 'setup wizard runChatGptLogin 符号已随文件删除' },
      { path: 'packages/cli/src/provider-codex-wizard.ts', kind: 'contains', pattern: 'summarizeAuth', description: 'setup wizard summarizeAuth 符号已随文件删除' },
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
      'FEAT-081K 已替换 mcp-tools 对 @haro/channel/ChannelRegistry 的依赖',
      'FEAT-081L 已删除 CLI channel list/doctor 与 packages/channel* package 面',
      '确认 AgentDock IM 已承接生产消息通道',
    ],
    requiredVerification: [
      'pnpm test:sidecar',
      'pnpm -F @haro/mcp-tools test -- test/tools/send-message.test.ts',
      'pnpm -F @haro/cli test -- test/legacy-removal-guard.test.ts',
      'pnpm -F @haro/cli test:legacy',
    ],
    decision: 'channel/消息边界已固化：真实 Feishu/Telegram/channel 管理由 AgentDock 提供，Haro 只保留 MCP send_message 工具；FEAT-081L 已删除 Haro-owned channel packages 与 CLI list/doctor/diagnostics runtime。',
    candidatePriority: {
      status: 'done',
      rank: 1,
      reason: 'FEAT-081L 已完成 channel-layer 第一轮收口；没有下一项 channel 删除授权。后续减法必须重新排序并单项评审其它模块。',
      forbiddenScope: ['MCP send_message 工具本身', 'AgentDock 生产消息能力', '真实 Feishu/Telegram IM 投递链路'],
    },
    physicalRemovals: [
      {
        candidate: 'packages/cli/src/gateway.ts',
        status: 'physically-removed',
        removedBy: 'FEAT-081E',
        rollbackPlan: 'git revert FEAT-081E commit 可恢复 gateway 源码、legacy env 注册路径和旧 gateway 测试。',
        note: '仅 gateway 旧 CLI daemon/control-plane 入口被删除；provider/memory/skills/Web/scenario-router 未获物理删除批准。',
      },
      {
        candidate: 'packages/cli/src/index.ts#channel-setup-onboarding-stub',
        status: 'physically-removed',
        removedBy: 'FEAT-081H',
        rollbackPlan: 'git revert FEAT-081H commit 可恢复 channel setup/onboarding removed stub 与对应测试。',
        note: '仅删除 081G removed/fail-closed stub 与 onboarding alias；MCP send_message 未获物理删除批准。',
      },
      {
        candidate: 'packages/cli/src/index.ts#channel-config-management-commands',
        status: 'physically-removed',
        removedBy: 'FEAT-081J',
        rollbackPlan: 'git revert FEAT-081J commit 可恢复 channel enable/disable/remove config mutation commands、disabled adapter autoload 与相关测试。',
        note: '仅删除 Haro-owned channel CLI config 管理路径；MCP send_message 和 AgentDock 生产消息能力仍保留。',
      },
      {
        candidate: 'packages/channel*/src#setup-contract',
        status: 'physically-removed',
        removedBy: 'FEAT-081J',
        rollbackPlan: 'git revert FEAT-081J commit 可恢复 ChannelSetupResult、ManagedChannel.setup 和 Feishu/Telegram setup 方法。',
        note: '仅删除旧 onboarding/setup contract；MCP send_message 和 AgentDock 生产消息能力仍保留。',
      },
      {
        candidate: 'packages/cli/src/index.ts#channel-list-doctor-runtime',
        status: 'physically-removed',
        removedBy: 'FEAT-081L',
        rollbackPlan: 'git revert FEAT-081L commit 可恢复 CLI channel list/doctor 与 diagnostics channel stage。',
        note: '只删除 Haro-owned channel list/doctor 与 enabled adapter runtime；不删除 MCP send_message 工具。',
      },
      {
        candidate: 'packages/channel',
        status: 'physically-removed',
        removedBy: 'FEAT-081L',
        rollbackPlan: 'git revert FEAT-081L commit 可恢复 @haro/channel package 与 package references。',
        note: 'Haro-owned channel protocol/registry package 已删除；AgentDock messaging contract 继续承接生产消息。',
      },
      {
        candidate: 'packages/channel-feishu',
        status: 'physically-removed',
        removedBy: 'FEAT-081L',
        rollbackPlan: 'git revert FEAT-081L commit 可恢复 @haro/channel-feishu package 与 tests。',
        note: 'Haro-owned Feishu adapter package 已删除；真实 Feishu 投递由 AgentDock host/IM manager 承接。',
      },
      {
        candidate: 'packages/channel-telegram',
        status: 'physically-removed',
        removedBy: 'FEAT-081L',
        rollbackPlan: 'git revert FEAT-081L commit 可恢复 @haro/channel-telegram package 与 tests。',
        note: 'Haro-owned Telegram adapter package 已删除；真实 Telegram/IM 投递由 AgentDock host/IM manager 承接。',
      },
    ],
    evidence: [
      { path: 'packages/channel/package.json', kind: 'exists', description: 'channel package 已由 FEAT-081L 删除' },
      { path: 'packages/channel-feishu/package.json', kind: 'exists', description: 'channel-feishu package 已由 FEAT-081L 删除' },
      { path: 'packages/channel-telegram/package.json', kind: 'exists', description: 'channel-telegram package 已由 FEAT-081L 删除' },
      { path: 'packages/cli/src/channel.ts', kind: 'exists', description: 'CLI channel package re-export 已由 FEAT-081L 删除' },
      { path: 'packages/cli/package.json', kind: 'contains', pattern: '@haro/channel', description: 'CLI 不再依赖 @haro/channel* packages' },
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
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'registerChannelCommands', description: 'CLI channel list/doctor 注册已由 FEAT-081L 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'channelRegistry', description: 'CLI channel registry runtime 已由 FEAT-081L 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'createDefaultAdditionalChannels', description: 'enabled adapter autoload runtime 已由 FEAT-081L 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: '@haro/channel-feishu', description: 'CLI 不再动态加载 Haro Feishu adapter' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: '@haro/channel-telegram', description: 'CLI 不再动态加载 Haro Telegram adapter' },
      { path: 'packages/cli/src/diagnostics.ts', kind: 'contains', pattern: 'checkChannels', description: 'diagnostics channel stage 已由 FEAT-081L 删除' },
      { path: 'packages/channel', kind: 'exists', description: 'packages/channel 已由 FEAT-081L 删除' },
      { path: 'packages/channel-feishu', kind: 'exists', description: 'packages/channel-feishu 已由 FEAT-081L 删除' },
      { path: 'packages/channel-telegram', kind: 'exists', description: 'packages/channel-telegram 已由 FEAT-081L 删除' },
      { path: 'package.json', kind: 'contains', pattern: '@haro/channel', description: 'root test scripts 不再引用 channel packages' },
      { path: 'packages/cli/package.json', kind: 'contains', pattern: '@haro/channel', description: 'CLI package dependency 已由 FEAT-081L 移除' },
      { path: 'packages/cli/tsconfig.json', kind: 'contains', pattern: '@haro/channel', description: 'CLI tsconfig path/reference 已由 FEAT-081L 移除' },
      { path: 'tsconfig.json', kind: 'contains', pattern: './packages/channel', description: 'root tsconfig references 已由 FEAT-081L 移除' },
      { path: 'packages/mcp-tools/package.json', kind: 'contains', pattern: '@haro/channel', description: 'mcp-tools package dependency 已由 FEAT-081K 移除' },
      { path: 'packages/mcp-tools/tsconfig.json', kind: 'contains', pattern: '@haro/channel', description: 'mcp-tools tsconfig path/reference 已由 FEAT-081K 移除' },
      { path: 'packages/mcp-tools/src/types.ts', kind: 'contains', pattern: 'ChannelRegistry', description: 'mcp-tools ToolDependencies 不再要求 Haro ChannelRegistry' },
      { path: 'packages/mcp-tools/src/bin/server-entry.ts', kind: 'contains', pattern: 'new ChannelRegistry', description: 'mcp-tools server-entry 不再创建空 Haro ChannelRegistry' },
      { path: 'packages/mcp-tools/test/helpers.ts', kind: 'contains', pattern: '@haro/channel', description: 'mcp-tools tests 不再使用 Haro channel test fake' },
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
      '移除 core barrel MemoryFabric export 前需证明下游 import 清零',
      '确认 legacy MCP memory_query 已由 FEAT-081X/F-3 保留注册但执行 fail-closed；memory_remember 已由 FEAT-081X/F-2 fail-closed',
      '确认 sidecar 主链路不读写 Haro-owned memory',
      '确认真实 ~/.haro 数据与 aria-memory-vault 不被迁移/删除',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/core test:legacy', 'pnpm -F @haro/cli test:legacy'],
    decision: 'FEAT-081U/C-1 只删除 `haro run --legacy-memory` CLI opt-in 与随附 CLI wiring；FEAT-081X/F-2 退役 Haro-owned memory write surfaces（CLI memory remember 与 legacy MCP memory_remember 执行 fail-closed）；FEAT-081X/F-3 只退役 legacy MCP memory_query read surface（保留注册但执行 TARGET_DISABLED，且不读取 Haro MemoryFabric）；memory 统一方向仍是共享 aria-memory-vault / AgentDock memory，但真实 ~/.haro 数据、aria-memory-vault、read-only/forensic memory 与 core MemoryFabric runtime 仍阻塞，不批准 core MemoryFabric、CLI read-only memory 或真实数据删除。',
    candidatePriority: {
      status: 'blocked',
      rank: 5,
      reason: '081U 删除 run --legacy-memory opt-in，081X/F-2 退役 write surfaces，081X/F-3 退役 legacy MCP memory_query 执行入口；Haro-owned memory 仍牵涉真实 ~/.haro 数据、aria-memory vault、read-only/forensic memory 和 core MemoryFabric runtime，删除前必须先完成数据/owner 边界验证。',
      blockedUntil: ['确认真实 ~/.haro memory 数据迁移/保留策略', '证明 core MemoryFabric runtime 无保留必要或完成 owner 交接', '证明 sidecar 主链路不读写 Haro-owned memory', '确认 aria-memory-vault 不在 Haro 删除范围'],
      forbiddenScope: ['真实 ~/.haro 数据', 'aria-memory vault'],
    },
    physicalRemovals: [
      {
        candidate: 'packages/cli/src/index.ts#--legacy-memory-opt-in',
        status: 'physically-removed',
        removedBy: 'FEAT-081U',
        rollbackPlan: 'git revert FEAT-081U commit 可恢复 haro run --legacy-memory CLI opt-in 与 CLI-side MemoryFabric wiring。',
        note: '仅删除 CLI opt-in/wiring；core MemoryFabric、haro memory read/forensic 子命令、MCP memory_query、真实 ~/.haro* 与 aria-memory-vault 均保持保护。',
      },
      {
        candidate: 'packages/cli/src/commands/memory.ts#memory-remember-write-surface+packages/mcp-tools/src/tools/memory-remember.ts#legacy-mcp-write-surface',
        status: 'physically-removed',
        removedBy: 'FEAT-081X',
        rollbackPlan: 'git revert FEAT-081X/F-2 commit 可恢复 CLI memory remember 与 legacy MCP memory_remember 写入行为。',
        note: '仅退役 Haro-owned memory write surfaces；core MemoryFabric、haro memory query/list/show/export/recover-snapshot、MCP memory_query、真实 ~/.haro*、aria-memory-vault 与 AgentDock memory 均保持保护。',
      },
      {
        candidate: 'packages/mcp-tools/src/tools/memory-query.ts#legacy-mcp-read-surface',
        status: 'physically-removed',
        removedBy: 'FEAT-081X',
        rollbackPlan: 'git revert FEAT-081X/F-3 commit 可恢复 legacy MCP memory_query 对 Haro MemoryFabric 的读取行为。',
        note: '仅退役 legacy MCP memory_query 执行入口；tool 注册、input schema 与 tools/list 稳定保留。core MemoryFabric、haro memory query/list/show/export/recover-snapshot、真实 ~/.haro*、aria-memory-vault 与 AgentDock memory 均保持保护。',
      },
    ],
    evidence: [
      { path: 'packages/core/src/index.ts', kind: 'contains', pattern: 'createMemoryFabric', description: 'core barrel 仍导出 MemoryFabric' },
      { path: 'packages/cli/src/commands/memory.ts', kind: 'exists', description: 'legacy memory CLI 仍存在' },
      { path: 'packages/mcp-tools/src/index.ts', kind: 'contains', pattern: 'memoryRememberTool', description: 'MCP default registry 仍注册 memory tool' },
      { path: 'packages/cli/src/commands/memory.ts', kind: 'contains', pattern: 'MEMORY_REMEMBER_RETIRED_MESSAGE', description: 'CLI memory remember 保留注册但 retired/fail-closed' },
      { path: 'packages/mcp-tools/src/tools/memory-remember.ts', kind: 'contains', pattern: 'MEMORY_REMEMBER_RETIRED_MESSAGE', description: 'legacy MCP memory_remember 保留注册但 retired/fail-closed' },
      { path: 'packages/mcp-tools/src/tools/memory-query.ts', kind: 'contains', pattern: 'MEMORY_QUERY_RETIRED_MESSAGE', description: 'legacy MCP memory_query 保留注册但 retired/fail-closed' },
      { path: 'packages/mcp-tools/src/tools/memory-query.ts', kind: 'contains', pattern: 'TARGET_DISABLED', description: 'legacy MCP memory_query 执行入口返回 TARGET_DISABLED' },
    ],
    verifiedAbsent: [
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: '--legacy-memory', description: 'haro run --legacy-memory CLI opt-in 已由 FEAT-081U 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'createLegacyMemoryFabric', description: 'CLI legacy createLegacyMemoryFabric factory wiring 已由 FEAT-081U 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'resolveLegacyMemoryRoots', description: 'CLI legacy memory path resolver wiring 已由 FEAT-081U 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'createCliMemoryWrapupHook', description: 'CLI memory wrapup hook wiring 已由 FEAT-081U 删除' },
      { path: 'packages/cli/src/commands/memory.ts', kind: 'contains', pattern: 'writeMemoryEntry', description: 'CLI memory remember 不再调用 Haro MemoryFabric writeMemoryEntry' },
      { path: 'packages/mcp-tools/src/tools/memory-remember.ts', kind: 'contains', pattern: 'memory.writeEntry', description: 'MCP memory_remember 不再调用 Haro MemoryFabric writeEntry' },
      { path: 'packages/mcp-tools/src/tools/memory-remember.ts', kind: 'contains', pattern: 'entryId: entry.id', description: 'MCP memory_remember 不再返回新写入的 Haro memory entry id' },
      { path: 'packages/mcp-tools/src/tools/memory-query.ts', kind: 'contains', pattern: 'ctx.deps.memory', description: 'MCP memory_query 不再读取 ToolDependencies.memory' },
      { path: 'packages/mcp-tools/src/tools/memory-query.ts', kind: 'contains', pattern: 'searchMemoryFiles', description: 'MCP memory_query 不再调用 Haro MemoryFabric searchMemoryFiles' },
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
    decision: 'FEAT-081S 仅删除 TeamOrchestrator removed-result 兼容 payload；scenario-router、runtime、run/chat/LLM provider path 仍保留且不获删除批准。',
    candidatePriority: {
      status: 'blocked',
      rank: 6,
      reason: '081S 只解除 TeamOrchestrator removed-result 兼容 payload 的本轮 defer 边界；scenario-router/runtime/run/chat/LLM provider path 仍有业务引用，不得作为 runtime 删除批准。',
      blockedUntil: ['证明 scenario-router/runtime/run/chat/LLM provider path 可替代或必须保留', '确认普通 single-agent fallback 不依赖 TeamOrchestrator removed payload', 'Review Board 可审且不依赖旧 haro team runtime'],
    },
    physicalRemovals: [
      {
        candidate: 'packages/core/src/team-orchestrator.ts',
        status: 'physically-removed',
        removedBy: 'FEAT-081D',
        rollbackPlan: 'git revert FEAT-081D commit 可恢复 team-orchestrator 源码、legacy export、CLI 兼容路径与旧测试。',
        note: '仅 TeamOrchestrator 旧兼容入口被删除；gateway/provider/channel/memory/skills/Web/scenario-router 未获物理删除批准。',
      },
      {
        candidate: 'packages/cli/src/index.ts#legacy-team-orchestrator-removed-result',
        status: 'physically-removed',
        removedBy: 'FEAT-081S',
        rollbackPlan: 'git revert FEAT-081S commit 可恢复 legacy_team_orchestrator_removed 兼容 payload 与专用返回函数。',
        note: '仅删除 TeamOrchestrator 已删除后遗留的 CLI removed-result 兼容入口；team-mode 无 directOutput 时改走普通 single-agent runner/fallback，scenario-router/runtime/provider path 均保留。',
      },
    ],
    evidence: [
      { path: 'packages/core/src/scenario-router.ts', kind: 'exists', description: 'scenario router 文件仍存在，不在 081D 删除范围' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'ScenarioRouter', description: 'CLI bootstrap 仍构造/引用 scenario router' },
    ],
    verifiedAbsent: [
      { path: 'packages/core/src/team-orchestrator.ts', kind: 'exists', description: 'team orchestrator 源文件已由 FEAT-081D 删除' },
      { path: 'packages/core/src/legacy/team-orchestrator.ts', kind: 'exists', description: 'team orchestrator legacy re-export 已由 FEAT-081D 删除' },
      { path: 'packages/core/package.json', kind: 'contains', pattern: './legacy/team-orchestrator', description: 'legacy package export 已由 FEAT-081D 移除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'legacyTeamOrchestratorRemovedResult', description: 'TeamOrchestrator removed-result 兼容函数已由 FEAT-081S 删除' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'legacy_team_orchestrator_removed', description: 'TeamOrchestrator removed-result 专用 payload 已由 FEAT-081S 删除' },
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
      '保留或迁移 eat/shit 兼容资产语义',
      '证明 haro skills install/enable/disable 用户入口已由 AgentDock 等价承接或明确退役',
      'legacy tests 分类稳定',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/skills test', 'pnpm -F @haro/cli test:legacy'],
    decision: 'FEAT-081V/D-1 仅退役 marketplace:<name> 占位 install surface，让 marketplace install 明确 fail-closed 并指向 AgentDock skills；packages/skills、SkillsManager、local/git install、eat/shit、sync-runtime 与 prepareTask 仍保留，不获删除批准。',
    candidatePriority: {
      status: 'defer',
      rank: 3,
      reason: '081V 已收口 marketplace:<name> 占位下载语义；packages/skills 仍承载 haro skills 用户入口、SkillsManager、local/git install 与 eat/shit 兼容流程，不能删除必要兼容资产。',
      blockedUntil: ['确认 eat/shit 资产语义由 sidecar artifacts 或 AgentDock skills 承接', '拆分 marketplace 与保留技能资产边界', '证明 haro skills install/enable/disable 已被等价替代或明确退役'],
    },
    physicalRemovals: [
      {
        candidate: 'packages/skills/src/manager.ts#marketplace-install-placeholder',
        status: 'physically-removed',
        removedBy: 'FEAT-081V',
        rollbackPlan: 'git revert FEAT-081V commit 可恢复 marketplace:<name> Phase 0 占位 install 文案。',
        note: '仅退役 marketplace:<name> 占位下载语义；不代表 packages/skills、SkillsManager、local/git install、eat/shit、sync-runtime 或 prepareTask 获得删除批准。',
      },
    ],
    evidence: [
      { path: 'packages/skills/package.json', kind: 'exists', description: 'skills package 仍存在' },
      { path: 'packages/cli/src/index.ts', kind: 'contains', pattern: 'SkillsManager', description: 'CLI bootstrap 仍初始化 SkillsManager' },
      { path: 'packages/skills/src/manager.ts', kind: 'contains', pattern: 'marketplace install has been retired', description: 'marketplace:<name> install 现在明确 retired/fail-closed' },
      { path: 'packages/skills/src/manager.ts', kind: 'contains', pattern: 'installFromPath', description: 'local path install 仍保留' },
      { path: 'packages/skills/src/manager.ts', kind: 'contains', pattern: 'installFromGit', description: 'git install 仍保留' },
      { path: 'packages/skills/src/manager.ts', kind: 'contains', pattern: 'runEat', description: 'eat 兼容资产调用仍保留' },
      { path: 'packages/skills/src/manager.ts', kind: 'contains', pattern: 'runShit', description: 'shit 兼容资产调用仍保留' },
      { path: 'packages/skills/src/manager.ts', kind: 'contains', pattern: 'syncRuntimeSkills', description: 'sync-runtime 能力仍保留' },
      { path: 'packages/skills/src/manager.ts', kind: 'contains', pattern: 'prepareTask', description: 'prepareTask skill matching 仍保留' },
    ],
    verifiedAbsent: [
      { path: 'packages/skills/src/manager.ts', kind: 'contains', pattern: 'Phase 0 仅保留 marketplace:<name> 命令框架', description: '旧 Phase 0 marketplace install 占位文案已由 FEAT-081V 删除' },
      { path: 'packages/skills/src/manager.ts', kind: 'contains', pattern: '尚未接入实际 marketplace 下载', description: '旧 marketplace 下载未接入文案已由 FEAT-081V 删除' },
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
      'FEAT-081T 已枚举 Review Board allowlist 与非 review Web/API 路由',
      '非 review Web/API surface 当前为空',
      'Web/API 包级删除仍需单独批准且当前禁止',
    ],
    requiredVerification: ['pnpm test:sidecar', 'pnpm -F @haro/web-api test', 'pnpm -F @haro/web build'],
    decision: 'FEAT-081T/B-1 只做 guard/docs schema closure：Review Board allowlist 与非 review Web/API 路由枚举已完成，非 review surface 为空；不删除任何 Web/API 路由或包。',
    candidatePriority: {
      status: 'done',
      rank: 5,
      reason: '081T 已确认非 review Web/API surface 为空；Web/API 当前只保留 Review Board + auth/bootstrap + health/fallback/infrastructure。done 仅表示枚举闭环，不是 runtime 或包级删除批准。',
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
  const reviewCandidate = nextDeletion;
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
      stage: 'FEAT-081X',
      lastCompletedStage: 'FEAT-081X',
      lastUpdatedBy: 'FEAT-081X',
      moduleRetirementBoundaries: LEGACY_MODULE_RETIREMENT_BOUNDARIES,
      nextDeletionCandidate: planningNext,
      nextReviewCandidate,
      forbiddenCandidateIds: items.filter((item) => item.candidatePriority.status === 'forbidden').map((item) => item.id),
      blockedCandidateIds: items.filter((item) => item.candidatePriority.status === 'blocked').map((item) => item.id),
      deferredCandidateIds: items.filter((item) => item.candidatePriority.status === 'defer').map((item) => item.id),
      completedPhysicalRemovals: items.flatMap((item) =>
        (item.physicalRemovals ?? []).map((removal) => ({ id: item.id, candidate: removal.candidate, removedBy: removal.removedBy, rollbackPlan: removal.rollbackPlan })),
      ),
    },
    items,
    nextActions: [
      '本报告只读，不批准物理删除。',
      '081I 固化模块级退役边界：channel/provider/memory/skills/Web 非主线面由 AgentDock 或共享能力承接；run/router/runtime/scenario 本轮 deferred。',
      '081J 已删除 Haro-owned channel CLI config 管理命令、disabled adapter autoload 和 adapter setup contract。',
      'FEAT-081K 已让 mcp-tools send_message 改用 AgentDock IPC 消息 contract，并移除 mcp-tools 对 @haro/channel 的依赖。',
      'FEAT-081L 已删除 packages/channel、packages/channel-feishu、packages/channel-telegram、CLI channel list/doctor 和 diagnostics channel stage。',
      'FEAT-081M 只刷新 docs/guard 与 AgentDock takeover evidence；不做物理删除，也不把任何候选升级为删除批准。',
      'FEAT-081N 已将 haro provider setup/onboarding CLI 入口 retired/fail-closed；081X 后 standalone provider CLI 管理面也已退役，但 provider-codex package/runtime 继续保留且不获删除批准。',
      'FEAT-081O 已删除 setup-only provider-codex wizard dead file，并将 diagnostics/provider remediation 改为 OPENAI_API_KEY / 外部 codex login / provider doctor 口径；不批准 provider runtime 删除。',
      'FEAT-081P 已删除旧 provider setup --write-env-file writer helper；ProviderEnvFileSummary/readProviderEnvFileSummary 与 provider env 只读 summary 继续保留。',
      'FEAT-081Q 已将 guard physicalRemoval singleton schema 统一迁移为 physicalRemovals[]；不改任何 runtime payload 或删除批准。',
      'FEAT-081R 已删除 provider setup retired 子命令 stub；haro provider setup ... 现在由 provider command unknown-command fail-closed，provider runtime 继续保留。',
      'FEAT-081S 已删除 TeamOrchestrator removed-result 兼容 payload；team-routing 无 skill directOutput 时走普通 single-agent fallback，scenario-router/runtime/provider path 继续保留。',
      'FEAT-081T/B-1 只做 Web/API guard/docs schema closure：非 review Web/API surface 为空，Review Board + auth/bootstrap + health/fallback/infrastructure 继续保留，不新增物理删除。',
      'FEAT-081U/C-1 已删除 haro run --legacy-memory CLI opt-in 与 CLI-side MemoryFabric wiring；core memory runtime、haro memory、MCP memory tools、真实 ~/.haro* 与 aria-memory-vault 继续保护。',
      'FEAT-081V/D-1 已退役 marketplace:<name> 占位 install surface；local/git install、SkillsManager、eat/shit、sync-runtime、prepareTask 与 packages/skills 仍保留且不获删除批准。',
      'FEAT-081X/F-1 已退役 standalone haro provider CLI 管理面；AgentDock/ModelHub 承接 provider 管理 owner，provider-codex runtime 与 diagnostics/review/run/chat LLM path 仍保留且不获删除批准。',
      'FEAT-081X/F-2 已退役 Haro-owned memory write surfaces：haro memory remember 与 legacy MCP memory_remember 保留注册但 fail-closed；FEAT-081X/F-3 已退役 legacy MCP memory_query 执行入口：保留注册但 TARGET_DISABLED，且不读取 ~/.haro memory 数据；core MemoryFabric、read-only/forensic memory、真实 ~/.haro* 与 aria-memory-vault 继续保护。',
      'channel-layer 当前没有下一项删除授权；如继续减法，需先补 AgentDock takeover 证据，再重新排序并单项评审其它模块。',
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
      const removals = item.physicalRemovals && item.physicalRemovals.length > 0
        ? ` physicalRemovals=${item.physicalRemovals.map((entry) => `${entry.status}:${entry.candidate}:${entry.removedBy}`).join(',')}`
        : '';
      const absent = item.verifiedAbsent.length > 0
        ? ` verifiedAbsent=${item.verifiedAbsent.filter((entry) => entry.absent).length}/${item.verifiedAbsent.length}`
        : '';
      const priority = ` priority=${item.candidatePriority.status}${item.candidatePriority.rank ? `#${item.candidatePriority.rank}` : ''}`;
      return `- ${item.id} [${item.state}] deleteAllowed=false evidence=${present}/${item.evidence.length}${absent}${priority}${pilot}${removals} decision=${item.decision}`;
    }),
    'next actions:',
    ...report.nextActions.map((action) => `- ${action}`),
  ];
  return `${lines.join('\n')}\n`;
}
