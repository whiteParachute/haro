import { describe, expect, it } from 'vitest';
import {
  ApplicationRecordSchema,
  ApprovalDecisionRecordSchema,
  ApprovalRequestRecordSchema,
  AssetSnapshotRecordSchema,
  AssetEventSchema,
  BlockedProposalEventSchema,
  DEFAULT_FEEDBACK_REVISION_DEPTH_LIMIT,
  EvolutionProposalSchema,
  FeedbackRevisionRecordSchema,
  FrontierSignalSchema,
  PatchBranchPlanRecordSchema,
  ProposalRevisionMetadataSchema,
  RollbackRecordSchema,
  ValidationReportSchema,
  createFakeAgentDockSource,
  lintApprovalConversationDescription,
  lintApprovalDecisionDescription,
  lintEvolutionProposalDescription,
} from '../src/index.js';

const now = '2026-05-08T04:00:00.000Z';

const validRef = { id: 'ref-001', kind: 'observation', uri: 'fake://ref/001' };


const feedbackRequirement = {
  id: 'requirement-001',
  category: 'evidence-required',
  disposition: 'incorporated',
  userText: '请说明这次到底是哪一类错误。',
  normalizedRequirement: '补充具体错误类别和样本证据。',
  proposalChangeRefs: [{ id: 'proposal-revision:change:0', kind: 'proposal-change' }],
  evidenceRefs: [{ id: 'runner-error-timeout', kind: 'runner-error' }],
  explanation: '新版提案收窄到 ModelHub 600 秒超时。',
};

const revisionNoOpCheck = {
  verdict: 'substantive-change',
  priorProposalContentHashes: ['sha256:prior-content'],
  revisedProposalContentHashes: ['sha256:revised-content'],
  priorSemanticFingerprint: 'sha256:prior-semantic',
  revisedSemanticFingerprint: 'sha256:revised-semantic',
  revisionDepth: 1,
  changedFields: ['changeSet', 'testPlan'],
  reason: '新版提案改变了目标字段和测试计划。',
};

const revisionMetadata = {
  revisionId: 'revision-001',
  rootProposalId: 'proposal-001',
  revisionOfProposalId: 'proposal-001',
  revisionDepth: 1,
  sourceApprovalRequestId: 'approval-request-001',
  sourceDecisionId: 'approval-decision-001',
  sourceDecisionDirection: '新的提案像元策略，请改成具体 patch。',
  sourceConversationRefs: ['file://approval-conversations/approval-request-001/revision-001.json'],
  rewritePlanRef: { id: 'feedback-revision-001', kind: 'feedback-revision' },
  supersedesProposalIds: ['proposal-001'],
  supersedesBlockedEventIds: ['blocked-001'],
  resubmissionReason: '根据 request-changes 收窄为具体 runner-profile 字段。',
  incorporatedFeedback: [feedbackRequirement],
  unresolvedFeedback: [],
  noOpCheck: revisionNoOpCheck,
  createdAt: now,
  updatedAt: now,
};

const validProposal = {
  id: 'proposal-001',
  title: 'Tune sidecar prompt wording',
  status: 'dry-run',
  level: 'L0',
  targetKind: 'prompt',
  riskLevel: 'low',
  sourceObservationRefs: [validRef],
  changeSet: [
    {
      op: 'update',
      targetRef: { id: 'prompt-default', kind: 'prompt' },
      contentRef: 'file://proposal/prompt-default.md',
      contentHash: 'sha256:abc123',
      summary: 'Clarify Haro sidecar boundary',
    },
  ],
  testPlan: {
    requiredCommands: ['git diff --check'],
    manualChecks: ['Review wording'],
    regressionRisks: ['Docs drift'],
  },
  rollbackPlan: {
    strategy: 'restore previous prompt content',
    snapshotRequired: true,
    rollbackRefs: [{ id: 'snapshot-001', kind: 'snapshot' }],
  },
  createdAt: now,
  updatedAt: now,
};

describe('AgentDock sidecar contract schemas [FEAT-043]', () => {
  it('accepts observation batches from the fake AgentDock source', () => {
    const source = createFakeAgentDockSource();

    const batch = source.collectObservationBatch();

    expect(batch.connectionId).toBe('fake-agentdock');
    expect(batch.sessions).toHaveLength(1);
    expect(batch.toolCalls[0]?.toolName).toBe('send_message');
  });

  it('rejects an evolution proposal without a rollback plan', () => {
    const { rollbackPlan: _rollbackPlan, ...withoutRollback } = validProposal;

    const result = EvolutionProposalSchema.safeParse(withoutRollback);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'rollbackPlan')).toBe(true);
    }
  });

  it('rejects applyEligible validation reports when rollback is not ready', () => {
    const result = ValidationReportSchema.safeParse({
      id: 'validation-001',
      proposalId: 'proposal-001',
      riskVerdict: 'low',
      requiredTests: ['git diff --check'],
      rollbackReady: false,
      applyEligible: true,
      blockingReasons: [],
      evidenceRefs: [],
      createdAt: now,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('rollbackReady');
    }
  });

  it('rejects asset events with an empty content hash', () => {
    const result = AssetEventSchema.safeParse({
      id: 'event-001',
      assetId: 'asset-001',
      kind: 'skill',
      version: '1.0.0',
      sourceRef: { id: 'proposal-001', kind: 'proposal' },
      contentRef: { id: 'skill-001', kind: 'file', uri: 'file://skill.md' },
      contentHash: '',
      status: 'proposed',
      eventType: 'proposed',
      actor: 'haro',
      createdAt: now,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'contentHash')).toBe(true);
    }
  });

  it('accepts a valid dry-run proposal fixture', () => {
    const proposal = EvolutionProposalSchema.parse(validProposal);

    expect(proposal.id).toBe('proposal-001');
    expect(proposal.humanReviewRequired).toBe(true);
    expect(proposal.humanApprovalRefs).toEqual([]);
  });


  it('accepts legacy proposals without revision metadata', () => {
    const proposal = EvolutionProposalSchema.parse(validProposal);

    expect(proposal.revisionMetadata).toBeUndefined();
  });

  it('accepts proposals with FEAT-076A revision metadata', () => {
    const proposal = EvolutionProposalSchema.parse({
      ...validProposal,
      id: 'proposal-revision-001',
      revisionMetadata,
    });

    expect(proposal.revisionMetadata?.revisionDepth).toBe(1);
    expect(proposal.revisionMetadata?.incorporatedFeedback[0]?.category).toBe('evidence-required');
    expect(proposal.revisionMetadata?.noOpCheck.verdict).toBe('substantive-change');
  });

  it('rejects empty critical revision metadata fields', () => {
    const result = ProposalRevisionMetadataSchema.safeParse({
      ...revisionMetadata,
      sourceDecisionId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'sourceDecisionId')).toBe(true);
    }
  });

  it('accepts feedback revision records for revised, manual-check, and blocked outcomes', () => {
    const baseRecord = {
      id: 'feedback-revision-001',
      rootProposalId: 'proposal-001',
      sourceProposalId: 'proposal-001',
      sourceApprovalRequestId: 'approval-request-001',
      sourceDecisionId: 'approval-decision-001',
      sourceDecisionDirection: '请把元策略改成具体 change。',
      parsedRequirements: [feedbackRequirement],
      rewriteActions: [
        {
          action: 'narrow-scope',
          summary: '只处理 ModelHub 600 秒超时。',
          targetRefs: [{ id: 'runner-profile:error-recovery', kind: 'runner-profile' }],
        },
      ],
      noOpCheck: revisionNoOpCheck,
      blockingReasons: [],
      createdAt: now,
      updatedAt: now,
    };

    const revised = FeedbackRevisionRecordSchema.parse({
      ...baseRecord,
      status: 'revised',
      revisedProposalId: 'proposal-revision-001',
      revisedValidationId: 'validation-revision-001',
      revisedApprovalRequestId: 'approval-request-revision-001',
    });
    expect(revised.status).toBe('revised');

    const manualCheck = FeedbackRevisionRecordSchema.parse({
      ...baseRecord,
      id: 'feedback-revision-manual-check',
      status: 'manual-check',
      noOpCheck: {
        ...revisionNoOpCheck,
        verdict: 'manual-check',
        revisionDepth: DEFAULT_FEEDBACK_REVISION_DEPTH_LIMIT + 1,
        changedFields: [],
        reason: 'revisionDepth 超过默认上限，需要人工判断是否继续重写。',
      },
      blockingReasons: ['revision depth exceeds default limit'],
    });
    expect(manualCheck.noOpCheck.revisionDepth).toBeGreaterThan(DEFAULT_FEEDBACK_REVISION_DEPTH_LIMIT);

    const blocked = FeedbackRevisionRecordSchema.parse({
      ...baseRecord,
      id: 'feedback-revision-blocked',
      status: 'blocked',
      noOpCheck: {
        ...revisionNoOpCheck,
        verdict: 'no-op',
        revisedProposalContentHashes: revisionNoOpCheck.priorProposalContentHashes,
        revisedSemanticFingerprint: revisionNoOpCheck.priorSemanticFingerprint,
        changedFields: [],
        reason: '新版只改 metadata，没有实际变更。',
      },
      blockingReasons: ['metadata-only revision'],
    });
    expect(blocked.status).toBe('blocked');
  });

  it('fails closed for incomplete feedback revision records', () => {
    const result = FeedbackRevisionRecordSchema.safeParse({
      id: 'feedback-revision-invalid',
      status: 'revised',
      rootProposalId: 'proposal-001',
      sourceProposalId: 'proposal-001',
      sourceApprovalRequestId: 'approval-request-001',
      sourceDecisionId: '',
      sourceDecisionDirection: '请重写。',
      noOpCheck: revisionNoOpCheck,
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
  });

  it('accepts a blocked proposal event for feedback-aware dedupe', () => {
    const event = BlockedProposalEventSchema.parse({
      id: 'blocked-001',
      status: 'blocked',
      reason: 'AWAITING_FEEDBACK_INCORPORATION',
      candidateProposalId: 'proposal-new',
      priorDecisionId: 'approval-decision-old',
      priorProposalId: 'proposal-old',
      priorDirection: '先把用户修改意见吸收进提案。',
      targetRef: { id: 'runner-profile:error-recovery', kind: 'runner-profile' },
      targetRefs: [{ id: 'runner-profile:error-recovery', kind: 'runner-profile' }],
      contentHash: 'sha256:content',
      contentHashes: ['sha256:content'],
      semanticFingerprint: 'sha256:semantic',
      createdAt: now,
    });

    expect(event.reason).toBe('AWAITING_FEEDBACK_INCORPORATION');
  });

  it('accepts a ready L0/L1 application gate record without applying content', () => {
    const record = ApplicationRecordSchema.parse({
      id: 'application-001',
      proposalId: 'proposal-001',
      validationId: 'validation-001',
      status: 'ready',
      gateCode: 'READY',
      level: 'L0',
      targetKind: 'prompt',
      applied: false,
      snapshotRef: { id: 'snapshot-001', kind: 'asset-snapshot' },
      rollbackRef: { id: 'rollback-001', kind: 'rollback-ref' },
      assetEventRefs: [],
      evidenceRefs: [{ id: 'proposal-001', kind: 'evolution-proposal' }],
      blockingReasons: [],
      createdAt: now,
      updatedAt: now,
    });

    expect(record.applied).toBe(false);
    expect(record.gateCode).toBe('READY');
  });

  it('accepts an approval request record with why/how/benefit review fields', () => {
    const record = ApprovalRequestRecordSchema.parse({
      id: 'approval-request-001',
      proposalId: 'proposal-001',
      validationId: 'validation-001',
      status: 'pending',
      title: 'Approve prompt wording improvement',
      level: 'L0',
      targetKind: 'prompt',
      riskLevel: 'low',
      sourceRef: { id: 'proposal-001', kind: 'evolution-proposal' },
      validationRef: { id: 'validation-001', kind: 'validation-report' },
      whyChange: ['AgentDock observation shows prompt clarity drift.'],
      howChange: ['Update the target prompt text through sidecar-owned assets/current.'],
      expectedBenefits: ['Improves operator understanding before apply.'],
      scope: ['Only touches Haro sidecar-owned prompt assets.'],
      requiredTests: ['git diff --check'],
      manualChecks: ['Review the generated approval request.'],
      regressionRisks: ['Prompt wording can drift.'],
      rollbackPlan: validProposal.rollbackPlan,
      decisionOptions: ['approve', 'reject', 'request-changes'],
      reviewerInstruction: 'Reply with approve, reject, or request-changes plus optional direction.',
      humanReviewRequired: true,
      evidenceRefs: [{ id: 'proposal-001', kind: 'evolution-proposal' }],
      descriptionRewrittenAt: now,
      createdAt: now,
      updatedAt: now,
    });

    expect(record.humanReviewRequired).toBe(true);
    expect(record.decisionOptions).toContain('request-changes');
    expect(record.descriptionRewrittenAt).toBe(now);
    expect(record.scope).toEqual(['Only touches Haro sidecar-owned prompt assets.']);
  });

  it('accepts approval decision records and requires direction for request-changes', () => {
    const record = ApprovalDecisionRecordSchema.parse({
      id: 'approval-decision-001',
      approvalRequestId: 'approval-request-001',
      proposalId: 'proposal-001',
      validationId: 'validation-001',
      decision: 'approve',
      reviewer: {
        source: 'haro-web',
        username: 'reviewer',
        role: 'owner',
      },
      sourceRef: { id: 'approval-request-001', kind: 'approval-request' },
      approvalRef: { id: 'approval-decision-001', kind: 'human-approval' },
      createdAt: now,
      updatedAt: now,
    });

    expect(record.decision).toBe('approve');

    const missingDirection = ApprovalDecisionRecordSchema.safeParse({
      ...record,
      id: 'approval-decision-002',
      decision: 'request-changes',
      approvalRef: undefined,
    });
    expect(missingDirection.success).toBe(false);
  });

  it('downgrades human approval decision text to info without blocker status', () => {
    const report = lintApprovalDecisionDescription(ApprovalDecisionRecordSchema.parse({
      id: 'approval-decision-human-long',
      approvalRequestId: 'approval-request-001',
      proposalId: 'proposal-001',
      validationId: 'validation-001',
      decision: 'request-changes',
      direction: '新的提案我还是看不懂，什么是 Haro 运行出现错误且旧提案没有讲清楚要怎么处理。',
      reviewer: { source: 'haro-web', username: 'reviewer', role: 'owner' },
      sourceRef: { id: 'approval-request-001', kind: 'approval-request' },
      createdAt: now,
      updatedAt: now,
    }));

    expect(report.status).toBe('pass');
    expect(report.infoCount).toBeGreaterThan(0);
    expect(report.blockerCount).toBe(0);
    expect(report.issues[0]).toMatchObject({ severity: 'info', source: 'human' });
  });

  it('downgrades human approval conversation text to info', () => {
    const report = lintApprovalConversationDescription({
      id: 'approval-conversation-001',
      messages: [
        {
          role: 'user',
          content: '新的提案我还是看不懂，什么是 Haro 运行出现错误且旧提案没有讲清楚要怎么处理。',
        },
      ],
    });

    expect(report.status).toBe('pass');
    expect(report.infoCount).toBeGreaterThan(0);
    expect(report.blockerCount).toBe(0);
    expect(report.issues[0]).toMatchObject({ severity: 'info', source: 'human' });
  });

  it('keeps machine proposal text at warning severity', () => {
    const report = lintEvolutionProposalDescription(EvolutionProposalSchema.parse({
      ...validProposal,
      title: '这是一条机器生成的非常长非常长非常长非常长非常长非常长非常长非常长的提案标题',
      testPlan: {
        ...validProposal.testPlan,
        manualChecks: ['本次是否回应上次审批意见？ 意见：这是一段机器自动追加的非常长非常长非常长检查项。'],
      },
    }));

    expect(report.status).toBe('warning');
    expect(report.warningCount).toBeGreaterThan(0);
    expect(report.blockerCount).toBe(0);
    expect(report.issues.every((issue) => issue.source === 'machine')).toBe(true);
  });

  it('requires applied application records to set applied=true', () => {
    const result = ApplicationRecordSchema.safeParse({
      id: 'application-001',
      proposalId: 'proposal-001',
      validationId: 'validation-001',
      status: 'applied',
      gateCode: 'READY',
      level: 'L0',
      targetKind: 'prompt',
      applied: false,
      snapshotRef: { id: 'snapshot-001', kind: 'asset-snapshot' },
      rollbackRef: { id: 'rollback-001', kind: 'rollback-ref' },
      assetEventRefs: [],
      evidenceRefs: [{ id: 'proposal-001', kind: 'evolution-proposal' }],
      blockingReasons: [],
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'applied')).toBe(true);
    }
  });

  it('accepts failed application records with gate reasons and no snapshot refs', () => {
    const record = ApplicationRecordSchema.parse({
      id: 'application-failed-001',
      proposalId: 'proposal-001',
      validationId: 'validation-001',
      status: 'failed',
      gateCode: 'APPLY_CONTENT_HASH_MISMATCH',
      level: 'L0',
      targetKind: 'mcp-tool-config',
      applied: false,
      assetEventRefs: [],
      evidenceRefs: [{ id: 'proposal-001', kind: 'evolution-proposal' }],
      blockingReasons: ['content hash mismatch'],
      createdAt: now,
      updatedAt: now,
    });

    expect(record.status).toBe('failed');
    expect(record.gateCode).toBe('APPLY_CONTENT_HASH_MISMATCH');
  });

  it('accepts snapshot and rollback metadata records for gate preflight', () => {
    const snapshot = AssetSnapshotRecordSchema.parse({
      id: 'snapshot-001',
      proposalId: 'proposal-001',
      validationId: 'validation-001',
      level: 'L0',
      targetKind: 'prompt',
      sourceRef: { id: 'proposal-001', kind: 'evolution-proposal' },
      entries: [
        {
          changeIndex: 0,
          targetRef: { id: 'prompt-default', kind: 'prompt' },
          assetId: 'prompt-default',
          existed: false,
          snapshotSource: 'absent',
        },
      ],
      createdAt: now,
    });
    const rollback = RollbackRecordSchema.parse({
      id: 'rollback-001',
      proposalId: 'proposal-001',
      validationId: 'validation-001',
      snapshotRef: { id: snapshot.id, kind: 'asset-snapshot' },
      sourceRef: { id: snapshot.id, kind: 'asset-snapshot' },
      reversible: true,
      entries: [
        {
          changeIndex: 0,
          targetRef: { id: 'prompt-default', kind: 'prompt' },
          assetId: 'prompt-default',
          action: 'delete-created-asset',
          existedBefore: false,
        },
      ],
      createdAt: now,
    });

    expect(snapshot.entries[0]?.existed).toBe(false);
    expect(rollback.entries[0]?.action).toBe('delete-created-asset');
  });

  it('rejects ready application records with blocking reasons', () => {
    const result = ApplicationRecordSchema.safeParse({
      id: 'application-001',
      proposalId: 'proposal-001',
      validationId: 'validation-001',
      status: 'ready',
      gateCode: 'READY',
      level: 'L0',
      targetKind: 'prompt',
      applied: false,
      snapshotRef: { id: 'snapshot-001', kind: 'asset-snapshot' },
      rollbackRef: { id: 'rollback-001', kind: 'rollback-ref' },
      blockingReasons: ['not ready'],
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'blockingReasons')).toBe(true);
    }
  });

  it('accepts a valid frontier signal fixture', () => {
    const signal = FrontierSignalSchema.parse({
      id: 'frontier-signal-001',
      sourceType: 'official-doc',
      sourceRef: {
        id: 'mcp-2026-05-08',
        kind: 'official-doc',
        uri: 'https://modelcontextprotocol.io/changelog',
      },
      title: 'MCP changelog for agent tool capabilities',
      publishedAt: now,
      collectedAt: now,
      summary: 'Official MCP changelog item relevant to tool orchestration.',
      claims: ['Tool annotations can improve orchestration safety.'],
      targetDomains: ['mcp-tools', 'agentdock-kernel'],
      confidence: 'high',
      rawRef: {
        id: 'mcp-raw-2026-05-08',
        kind: 'html',
        uri: 'https://modelcontextprotocol.io/changelog',
      },
      status: 'active',
    });

    expect(signal.sourceType).toBe('official-doc');
    expect(signal.targetDomains).toContain('mcp-tools');
  });

  it('accepts an L2/L3 patch branch plan and rejects L0/L1 plans', () => {
    const plan = PatchBranchPlanRecordSchema.parse({
      id: 'patch_branch_plan_001',
      proposalId: 'proposal-l2',
      validationId: 'validation-l2',
      status: 'planned',
      level: 'L2',
      targetKind: 'haro-code',
      sourceRef: { id: 'proposal-l2', kind: 'evolution-proposal' },
      validationRef: { id: 'validation-l2', kind: 'validation-report' },
      branchName: 'haro/evolution/proposal-l2',
      changeRefs: [{ id: 'proposal-l2:change:0', kind: 'proposal-change' }],
      requiredTests: ['pnpm test'],
      manualChecks: ['Review patch diff'],
      regressionRisks: ['runtime regression'],
      rollbackPlan: {
        strategy: 'revert patch branch',
        snapshotRequired: false,
        rollbackRefs: [],
      },
      humanReviewRequired: true,
      evidenceRefs: [{ id: 'proposal-l2', kind: 'evolution-proposal' }],
      createdAt: now,
      updatedAt: now,
    });

    expect(plan.level).toBe('L2');
    const invalid = PatchBranchPlanRecordSchema.safeParse({
      ...plan,
      id: 'patch_branch_plan_l1',
      level: 'L1',
      targetKind: 'skill',
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects frontier signals without sourceRef or summary', () => {
    const result = FrontierSignalSchema.safeParse({
      id: 'frontier-signal-missing-fields',
      sourceType: 'paper',
      title: 'Incomplete signal',
      collectedAt: now,
      claims: [],
      targetDomains: ['runner'],
      confidence: 'medium',
      status: 'active',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'sourceRef')).toBe(true);
      expect(result.error.issues.some((issue) => issue.path[0] === 'summary')).toBe(true);
    }
  });

  it('rejects memory as a Haro-owned proposal target', () => {
    const result = EvolutionProposalSchema.safeParse({
      ...validProposal,
      targetKind: 'memory',
      changeSet: [
        {
          op: 'update',
          targetRef: { id: 'memory-entry-001', kind: 'memory' },
          contentRef: 'agentdock://memory/entry-001',
          contentHash: 'sha256:memory',
          summary: 'Attempt to mutate AgentDock-owned memory',
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'targetKind')).toBe(true);
    }
  });
});
