import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWebApp } from '../src/index.js';
import type { WebLogger } from '../src/types.js';

const logger: WebLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'haro-web-approval-'));
  writeFixture(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('approval request review API', () => {
  it('lists pending approval requests and returns detail', async () => {
    const app = createWebApp({ logger, runtime: { root } });

    const list = await app.request('/api/v1/approval-requests');
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.data.total).toBe(2);
    expect(listBody.data.items.map((item: { request: { id: string } }) => item.request.id)).toEqual([
      'approval_request_zzz_older',
      'approval_request_smoke',
    ]);
    expect(listBody.data.items[1].latestDecision).toBeUndefined();

    const detail = await app.request('/api/v1/approval-requests/approval_request_smoke');
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.data.request.title).toBe('Review proposal smoke');
  });

  it('exposes feedback revision context and labels superseded source requests', async () => {
    writeRevisionFixture(root);
    const app = createWebApp({ logger, runtime: { root } });

    const revision = await app.request('/api/v1/approval-requests/approval_request_revision');
    expect(revision.status).toBe(200);
    const revisionBody = await revision.json();
    expect(revisionBody.data.revision).toMatchObject({
      isRevision: true,
      label: 'revision',
      rootProposalId: 'proposal_source_revision',
      revisionOfProposalId: 'proposal_source_revision',
      revisionDepth: 1,
      sourceApprovalRequestId: 'approval_request_source_revision',
      sourceDecisionId: 'approval_decision_source_revision',
      sourceDecisionDirection: '请补充具体错误证据，并收窄范围。',
      resubmissionReason: '根据上次意见，只补一条具体错误处理规则。',
    });
    expect(revisionBody.data.revision.incorporatedFeedback[0]).toMatchObject({
      category: 'evidence-required',
      disposition: 'incorporated',
      normalizedRequirement: '补充具体错误样本。',
    });
    expect(revisionBody.data.revision.unresolvedFeedback[0]).toMatchObject({
      category: 'risk-rollback-change',
      disposition: 'needs-human',
    });
    expect(revisionBody.data.revision.sourceConversationRefs).toEqual([
      'haro-sidecar://approval-conversations/approval_request_source_revision/conversation_1',
    ]);

    const source = await app.request('/api/v1/approval-requests/approval_request_source_revision');
    expect(source.status).toBe(200);
    const sourceBody = await source.json();
    expect(sourceBody.data.revision).toMatchObject({
      isRevision: false,
      label: 'superseded-source',
      supersededBy: {
        proposalId: 'proposal_revised_revision',
        approvalRequestId: 'approval_request_revision',
        revisionDepth: 1,
        sourceDecisionId: 'approval_decision_source_revision',
      },
    });
  });

  it('records an approval once and appends the human approval ref to the proposal', async () => {
    const app = createWebApp({ logger, runtime: { root } });

    const approved = await app.request('/api/v1/approval-requests/approval_request_smoke/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(approved.status).toBe(200);
    const approvedBody = await approved.json();
    expect(approvedBody.data.decision.decision).toBe('approve');
    expect(approvedBody.data.decision.descriptionLint.status).toBe('pass');
    expect(approvedBody.data.proposalUpdated).toBe(true);

    const proposal = JSON.parse(readFileSync(path.join(root, 'evolution/proposals/proposal_smoke.json'), 'utf8'));
    expect(proposal.humanApprovalRefs).toHaveLength(1);
    expect(proposal.humanApprovalRefs[0].kind).toBe('human-approval');

    const repeat = await app.request('/api/v1/approval-requests/approval_request_smoke/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(repeat.status).toBe(409);

    const decided = await app.request('/api/v1/approval-requests?status=decided');
    expect(decided.status).toBe(200);
    const decidedBody = await decided.json();
    expect(decidedBody.data.total).toBe(1);
    expect(decidedBody.data.items[0].lifecycle.status).toBe('approved');

    writeAppliedLifecycleFixture(root);
    const applied = await app.request('/api/v1/approval-requests/approval_request_smoke');
    expect(applied.status).toBe(200);
    const appliedBody = await applied.json();
    expect(appliedBody.data.lifecycle.status).toBe('applied');
    expect(appliedBody.data.lifecycle.application.id).toBe('application_smoke');
    expect(appliedBody.data.lifecycle.snapshot.id).toBe('snapshot_smoke');
    expect(appliedBody.data.lifecycle.rollback.id).toBe('rollback_smoke');
    expect(appliedBody.data.lifecycle.assetEvents[0].id).toBe('asset_event_smoke');
  });

  it('requires direction for request-changes decisions', async () => {
    const app = createWebApp({ logger, runtime: { root } });

    const response = await app.request('/api/v1/approval-requests/approval_request_smoke/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'request-changes' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('requires direction');
  });

  it('persists request-changes conversations and streams an agent reply', async () => {
    const app = createWebApp({
      logger,
      runtime: {
        root,
        reviewConversationReply: async (input) => {
          input.onText?.('收到，');
          input.onText?.('我会整理修改点。');
          return {
            content: '收到，我会整理修改点。',
            provider: 'stub-provider',
            model: 'stub-model',
            sessionId: 'session_review_smoke',
          };
        },
      },
    });

    const created = await app.request('/api/v1/approval-requests/approval_request_smoke/conversations', {
      method: 'POST',
    });
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    const conversationId = createdBody.data.id as string;

    const appended = await app.request(
      `/api/v1/approval-requests/approval_request_smoke/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '请把用户收益和回滚方案说清楚。' }),
      },
    );
    expect(appended.status).toBe(200);

    const reply = await app.request(
      `/api/v1/approval-requests/approval_request_smoke/conversations/${conversationId}/agent-reply`,
      { method: 'POST' },
    );
    expect(reply.status).toBe(200);
    const stream = await reply.text();
    expect(stream).toContain('event: delta');
    expect(stream).toContain('event: done');
    expect(stream).toContain('我会整理修改点');

    const listed = await app.request('/api/v1/approval-requests/approval_request_smoke/conversations');
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.data.total).toBe(1);
    expect(listedBody.data.items[0].messages.map((message: { role: string }) => message.role)).toEqual([
      'user',
      'assistant',
    ]);

    const decided = await app.request('/api/v1/approval-requests/approval_request_smoke/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        decision: 'request-changes',
        conversationId,
        direction: '请按对话中的修改意见重写提案。',
      }),
    });
    expect(decided.status).toBe(200);
    const decidedBody = await decided.json();
    expect(decidedBody.data.decision.direction).toContain('对话摘要');
    expect(decidedBody.data.decision.direction).toContain('请把用户收益和回滚方案说清楚');
    expect(decidedBody.data.decision.direction).toContain('haro-sidecar://approval-conversations/');
    expect(decidedBody.data.decision.descriptionLint.status).toBe('pass');
  });

  it('records request-changes decisions and supersedes the proposal', async () => {
    const app = createWebApp({ logger, runtime: { root } });

    const response = await app.request('/api/v1/approval-requests/approval_request_smoke/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        decision: 'request-changes',
        direction: 'Keep this proposal scoped to the approval review page only.',
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.decision.decision).toBe('request-changes');
    expect(body.data.decision.direction).toContain('approval review page');
    expect(body.data.decision.descriptionLint.status).toBe('pass');
    expect(body.data.decision.descriptionLint.infoCount).toBeGreaterThan(0);
    expect(body.data.decision.descriptionLint.blockerCount).toBe(0);
    expect(body.data.decision.descriptionLint.issues[0]?.source).toBe('human');
    expect(body.data.proposalUpdated).toBe(true);

    const proposal = JSON.parse(readFileSync(path.join(root, 'evolution/proposals/proposal_smoke.json'), 'utf8'));
    expect(proposal.status).toBe('superseded');
    expect(proposal.humanApprovalRefs).toHaveLength(0);
  });
});

function writeFixture(haroHome: string): void {
  const now = '2026-05-14T00:00:00.000Z';
  const requestDir = path.join(haroHome, 'evolution/approval-requests');
  const proposalDir = path.join(haroHome, 'evolution/proposals');
  mkdirSync(requestDir, { recursive: true });
  mkdirSync(proposalDir, { recursive: true });

  writeFileSync(
    path.join(proposalDir, 'proposal_smoke.json'),
    `${JSON.stringify({
      id: 'proposal_smoke',
      title: 'Review proposal smoke',
      status: 'validated',
      level: 'L1',
      targetKind: 'skill',
      riskLevel: 'low',
      sourceObservationRefs: [{ id: 'obs_smoke', kind: 'observation-batch' }],
      changeSet: [
        {
          op: 'update',
          targetRef: { id: 'skill_smoke', kind: 'skill' },
          summary: 'Tighten proposal review wording.',
        },
      ],
      testPlan: {
        requiredCommands: ['pnpm test'],
        manualChecks: ['Reviewer confirms proposal body.'],
        regressionRisks: ['Review record may be duplicated.'],
      },
      rollbackPlan: {
        strategy: 'Revert generated proposal update.',
        snapshotRequired: false,
        rollbackRefs: [],
      },
      humanReviewRequired: true,
      humanApprovalRefs: [],
      createdAt: now,
      updatedAt: now,
    }, null, 2)}\n`,
    'utf8',
  );

  writeFileSync(
    path.join(requestDir, 'approval_request_smoke.json'),
    `${JSON.stringify({
      id: 'approval_request_smoke',
      proposalId: 'proposal_smoke',
      validationId: 'validation_smoke',
      status: 'pending',
      title: 'Review proposal smoke',
      level: 'L1',
      targetKind: 'skill',
      riskLevel: 'low',
      sourceRef: { id: 'proposal_smoke', kind: 'evolution-proposal' },
      validationRef: { id: 'validation_smoke', kind: 'validation-report' },
      whyChange: ['The sidecar detected stale review instructions.'],
      howChange: ['Update the skill text after human review.'],
      expectedBenefits: ['Keeps Haro proposals reviewable before apply.'],
      requiredTests: ['pnpm test'],
      manualChecks: ['Read the diff before approving.'],
      regressionRisks: ['Reviewer could approve the wrong proposal.'],
      rollbackPlan: {
        strategy: 'Revert generated proposal update.',
        snapshotRequired: false,
        rollbackRefs: [],
      },
      decisionOptions: ['approve', 'reject', 'request-changes'],
      reviewerInstruction: 'Approve only after verifying the proposal content.',
      humanReviewRequired: true,
      evidenceRefs: [],
      createdAt: now,
      updatedAt: now,
    }, null, 2)}\n`,
    'utf8',
  );

  writeFileSync(
    path.join(requestDir, 'approval_request_zzz_older.json'),
    `${JSON.stringify({
      id: 'approval_request_zzz_older',
      proposalId: 'proposal_older',
      validationId: 'validation_older',
      status: 'pending',
      title: 'Older review proposal',
      level: 'L0',
      targetKind: 'mcp-tool-config',
      riskLevel: 'low',
      sourceRef: { id: 'proposal_older', kind: 'evolution-proposal' },
      validationRef: { id: 'validation_older', kind: 'validation-report' },
      whyChange: ['This older request should be reviewed first.'],
      howChange: ['Keep the list ordered by creation time.'],
      expectedBenefits: ['Humans can drain the oldest pending work first.'],
      requiredTests: [],
      manualChecks: [],
      regressionRisks: [],
      rollbackPlan: {
        strategy: 'No artifact change in this fixture.',
        snapshotRequired: false,
        rollbackRefs: [],
      },
      decisionOptions: ['approve', 'reject', 'request-changes'],
      reviewerInstruction: 'Review older requests first.',
      humanReviewRequired: true,
      evidenceRefs: [],
      createdAt: '2026-05-13T00:00:00.000Z',
      updatedAt: '2026-05-13T00:00:00.000Z',
    }, null, 2)}\n`,
    'utf8',
  );
}

function writeRevisionFixture(haroHome: string): void {
  const proposalDir = path.join(haroHome, 'evolution/proposals');
  const requestDir = path.join(haroHome, 'evolution/approval-requests');
  const decisionDir = path.join(haroHome, 'evolution/approval-decisions');
  mkdirSync(proposalDir, { recursive: true });
  mkdirSync(requestDir, { recursive: true });
  mkdirSync(decisionDir, { recursive: true });

  const baseProposal = {
    title: '修订运行错误处理提案',
    level: 'L1',
    targetKind: 'runner-profile',
    riskLevel: 'medium',
    sourceObservationRefs: [{ id: 'obs_revision', kind: 'observation-batch' }],
    changeSet: [
      {
        op: 'update',
        targetRef: { id: 'haro-sidecar:runner-profile:error-recovery-policy', kind: 'runner-profile' },
        contentHash: 'sha256:source-revision',
        summary: '补充 ModelHub timeout 处理规则。',
      },
    ],
    testPlan: {
      requiredCommands: ['pnpm test'],
      manualChecks: ['核对修订链路。'],
      regressionRisks: ['修订信息可能展示不清。'],
    },
    rollbackPlan: {
      strategy: '删除新增规则即可回滚。',
      snapshotRequired: false,
      rollbackRefs: [],
    },
    humanReviewRequired: true,
    humanApprovalRefs: [],
    createdAt: '2026-05-21T10:00:00.000Z',
    updatedAt: '2026-05-21T10:00:00.000Z',
  };

  writeFileSync(
    path.join(proposalDir, 'proposal_source_revision.json'),
    `${JSON.stringify({
      ...baseProposal,
      id: 'proposal_source_revision',
      status: 'superseded',
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(requestDir, 'approval_request_source_revision.json'),
    `${JSON.stringify({
      id: 'approval_request_source_revision',
      proposalId: 'proposal_source_revision',
      validationId: 'validation_source_revision',
      status: 'pending',
      title: '修订运行错误处理提案',
      level: 'L1',
      targetKind: 'runner-profile',
      riskLevel: 'medium',
      sourceRef: { id: 'proposal_source_revision', kind: 'evolution-proposal' },
      validationRef: { id: 'validation_source_revision', kind: 'validation-report' },
      whyChange: ['旧提案缺少具体错误证据。'],
      howChange: ['要求 Haro 收窄为一条具体规则。'],
      expectedBenefits: ['减少重复而空泛的审批请求。'],
      requiredTests: ['pnpm test'],
      manualChecks: ['核对旧请求被新修订替代。'],
      regressionRisks: ['旧请求和新请求可能混淆。'],
      rollbackPlan: { strategy: '不应用即可回退。', snapshotRequired: false, rollbackRefs: [] },
      decisionOptions: ['approve', 'reject', 'request-changes'],
      reviewerInstruction: '请等待修订提案。',
      humanReviewRequired: true,
      evidenceRefs: [],
      createdAt: '2026-05-21T10:01:00.000Z',
      updatedAt: '2026-05-21T10:01:00.000Z',
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(decisionDir, 'approval_decision_source_revision.json'),
    `${JSON.stringify({
      id: 'approval_decision_source_revision',
      approvalRequestId: 'approval_request_source_revision',
      proposalId: 'proposal_source_revision',
      validationId: 'validation_source_revision',
      decision: 'request-changes',
      direction: '请补充具体错误证据，并收窄范围。',
      reviewer: { source: 'test', role: 'owner' },
      sourceRef: { id: 'approval_request_source_revision', kind: 'approval-request' },
      createdAt: '2026-05-21T10:02:00.000Z',
      updatedAt: '2026-05-21T10:02:00.000Z',
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(proposalDir, 'proposal_revised_revision.json'),
    `${JSON.stringify({
      ...baseProposal,
      id: 'proposal_revised_revision',
      status: 'validated',
      changeSet: [
        {
          op: 'update',
          targetRef: { id: 'haro-sidecar:runner-profile:error-recovery-policy', kind: 'runner-profile' },
          contentHash: 'sha256:revised-revision',
          summary: '只补 ModelHub timeout 的证据规则。',
        },
      ],
      revisionMetadata: {
        revisionId: 'revision_api_smoke',
        rootProposalId: 'proposal_source_revision',
        revisionOfProposalId: 'proposal_source_revision',
        revisionDepth: 1,
        sourceApprovalRequestId: 'approval_request_source_revision',
        sourceDecisionId: 'approval_decision_source_revision',
        sourceDecisionDirection: '请补充具体错误证据，并收窄范围。',
        sourceConversationRefs: ['haro-sidecar://approval-conversations/approval_request_source_revision/conversation_1'],
        supersedesProposalIds: ['proposal_source_revision'],
        supersedesBlockedEventIds: [],
        resubmissionReason: '根据上次意见，只补一条具体错误处理规则。',
        incorporatedFeedback: [
          {
            id: 'req_evidence',
            category: 'evidence-required',
            disposition: 'incorporated',
            userText: '请补充具体错误证据。',
            normalizedRequirement: '补充具体错误样本。',
            proposalChangeRefs: [],
            evidenceRefs: [],
            explanation: '修订说明会展示错误样本来源。',
          },
        ],
        unresolvedFeedback: [
          {
            id: 'req_risk',
            category: 'risk-rollback-change',
            disposition: 'needs-human',
            userText: '风险还要人工判断。',
            normalizedRequirement: '人工确认风险可接受。',
            proposalChangeRefs: [],
            evidenceRefs: [],
            explanation: '本轮只做展示，不替用户确认风险。',
          },
        ],
        noOpCheck: {
          verdict: 'substantive-change',
          priorProposalContentHashes: ['sha256:source-revision'],
          revisedProposalContentHashes: ['sha256:revised-revision'],
          revisionDepth: 1,
          changedFields: ['changeSet'],
          reason: '内容指纹变化，且收窄为具体规则。',
        },
        createdAt: '2026-05-21T10:03:00.000Z',
        updatedAt: '2026-05-21T10:03:00.000Z',
      },
      updatedAt: '2026-05-21T10:03:00.000Z',
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(requestDir, 'approval_request_revision.json'),
    `${JSON.stringify({
      id: 'approval_request_revision',
      proposalId: 'proposal_revised_revision',
      validationId: 'validation_revised_revision',
      status: 'pending',
      title: '修订运行错误处理提案',
      level: 'L1',
      targetKind: 'runner-profile',
      riskLevel: 'medium',
      sourceRef: { id: 'proposal_revised_revision', kind: 'evolution-proposal' },
      validationRef: { id: 'validation_revised_revision', kind: 'validation-report' },
      whyChange: ['这是按上次意见提交的修订。'],
      howChange: ['展示已吸收和未解决的反馈。'],
      expectedBenefits: ['审批人能看清修订链路。'],
      requiredTests: ['pnpm test'],
      manualChecks: ['核对 revision metadata。'],
      regressionRisks: ['修订链路展示可能不完整。'],
      rollbackPlan: { strategy: '不应用即可回退。', snapshotRequired: false, rollbackRefs: [] },
      decisionOptions: ['approve', 'reject', 'request-changes'],
      reviewerInstruction: '先核对上次意见是否被回应。',
      humanReviewRequired: true,
      evidenceRefs: [],
      createdAt: '2026-05-21T10:04:00.000Z',
      updatedAt: '2026-05-21T10:04:00.000Z',
    }, null, 2)}\n`,
    'utf8',
  );
}

function writeAppliedLifecycleFixture(haroHome: string): void {
  const now = '2026-05-14T00:30:00.000Z';
  const applicationDir = path.join(haroHome, 'evolution/applications');
  const snapshotDir = path.join(haroHome, 'evolution/snapshots');
  const rollbackDir = path.join(haroHome, 'evolution/rollbacks');
  const eventDir = path.join(haroHome, 'assets/events');
  mkdirSync(applicationDir, { recursive: true });
  mkdirSync(snapshotDir, { recursive: true });
  mkdirSync(rollbackDir, { recursive: true });
  mkdirSync(eventDir, { recursive: true });

  writeFileSync(
    path.join(snapshotDir, 'snapshot_smoke.json'),
    `${JSON.stringify({
      id: 'snapshot_smoke',
      proposalId: 'proposal_smoke',
      validationId: 'validation_smoke',
      level: 'L1',
      targetKind: 'skill',
      sourceRef: { id: 'proposal_smoke', kind: 'evolution-proposal' },
      entries: [
        {
          changeIndex: 0,
          targetRef: { id: 'skill_smoke', kind: 'skill' },
          assetId: 'skill_smoke',
          existed: false,
          snapshotSource: 'absent',
        },
      ],
      createdAt: now,
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(rollbackDir, 'rollback_smoke.json'),
    `${JSON.stringify({
      id: 'rollback_smoke',
      proposalId: 'proposal_smoke',
      validationId: 'validation_smoke',
      snapshotRef: { id: 'snapshot_smoke', kind: 'asset-snapshot' },
      sourceRef: { id: 'snapshot_smoke', kind: 'asset-snapshot' },
      reversible: true,
      entries: [
        {
          changeIndex: 0,
          targetRef: { id: 'skill_smoke', kind: 'skill' },
          assetId: 'skill_smoke',
          action: 'delete-created-asset',
          existedBefore: false,
        },
      ],
      createdAt: now,
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(eventDir, 'asset_event_smoke.json'),
    `${JSON.stringify({
      id: 'asset_event_smoke',
      assetId: 'skill_smoke',
      kind: 'skill',
      version: 'hash-smoke',
      sourceRef: { id: 'application_smoke', kind: 'application-record' },
      contentRef: { id: 'skill_smoke.json', kind: 'sidecar-current-content' },
      contentHash: 'hash-smoke',
      status: 'applied',
      eventType: 'applied',
      actor: 'haro',
      proposalRef: { id: 'proposal_smoke', kind: 'evolution-proposal' },
      validationRef: { id: 'validation_smoke', kind: 'validation-report' },
      rollbackMetadata: {
        rollbackRef: { id: 'rollback_smoke', kind: 'rollback-ref' },
        snapshotRef: { id: 'snapshot_smoke', kind: 'asset-snapshot' },
        reversible: true,
      },
      createdAt: now,
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(applicationDir, 'application_smoke.json'),
    `${JSON.stringify({
      id: 'application_smoke',
      proposalId: 'proposal_smoke',
      validationId: 'validation_smoke',
      status: 'applied',
      gateCode: 'READY',
      level: 'L1',
      targetKind: 'skill',
      applied: true,
      snapshotRef: { id: 'snapshot_smoke', kind: 'asset-snapshot' },
      rollbackRef: { id: 'rollback_smoke', kind: 'rollback-ref' },
      assetEventRefs: [{ id: 'asset_event_smoke', kind: 'asset-event' }],
      evidenceRefs: [{ id: 'proposal_smoke', kind: 'evolution-proposal' }],
      blockingReasons: [],
      createdAt: now,
      updatedAt: now,
    }, null, 2)}\n`,
    'utf8',
  );
}
