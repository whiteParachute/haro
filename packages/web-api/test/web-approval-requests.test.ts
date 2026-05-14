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
    expect(listBody.data.total).toBe(1);
    expect(listBody.data.items[0].request.id).toBe('approval_request_smoke');
    expect(listBody.data.items[0].latestDecision).toBeUndefined();

    const detail = await app.request('/api/v1/approval-requests/approval_request_smoke');
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.data.request.title).toBe('Review proposal smoke');
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
}
